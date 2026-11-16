"""
Shrinks a skinned .glb with KHR_mesh_quantization — numpy only, no npm tool.

Positions become normalised int16, normals int8, UVs uint16 and skin weights
uint8, which roughly halves the vertex data. The extension is read natively by
three.js's GLTFLoader, so nothing extra ships to decode it — unlike Draco or
meshopt, both of which need a decoder (and a wasm module) in the page. Used by
prepare_model.py; see `quantize_skinned` for where the dequantisation goes.
"""

from __future__ import annotations

import json
import struct
import sys

import numpy as np

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, 'not a glTF 2 binary'
    off = 12
    doc, bin_ = None, b''
    while off < len(data):
        length, kind = struct.unpack_from('<II', data, off)
        chunk = data[off + 8 : off + 8 + length]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            bin_ = chunk
        off += 8 + length
    return doc, bin_


def accessor_array(doc, bin_, index):
    acc = doc['accessors'][index]
    view = doc['bufferViews'][acc['bufferView']]
    dtype = np.dtype(COMPONENT[acc['componentType']])
    width = WIDTH[acc['type']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride', 0) or dtype.itemsize * width
    count = acc['count']
    raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * (count - 1) + dtype.itemsize * width, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(count, dtype.itemsize * width), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(dtype).reshape(count, width)


def quantize_skinned(src, dst, opaque=()):
    """
    Quantizes a skinned model. The usual place for the dequantisation — the
    mesh's own node transform — is unusable here: the glTF spec ignores a
    skinned mesh's node transform (three.js applies it as the bind matrix
    instead), so a scale put there would mean different things to each.

    It goes into the skin instead. Positions are scaled by one factor about
    the origin — no offset — and each inverse bind matrix takes that factor
    on its right. A uniform scale about the origin commutes with whatever
    rotation and scale sit above the mesh, so the result is the same whether a
    reader follows the spec or three's bind matrix. Every skinned mesh must
    share the one skin, which is checked.

    Also: normals to int8, UVs to uint16 (they lie in [0, 1], which is checked),
    skin weights to uint8 summing to exactly 255, and the BLEND alpha mode
    dropped from the materials named in `opaque` — for a material whose
    texture has no alpha channel, BLEND only costs depth-sorting glitches.
    """
    doc, bin_ = read_glb(src)
    out = bytearray()
    views, accessors = [], []

    def add_view(arr, target=None, stride=None):
        while len(out) % 4:
            out.append(0)
        view = {'buffer': 0, 'byteOffset': len(out), 'byteLength': arr.nbytes}
        if target:
            view['target'] = target
        if stride:
            view['byteStride'] = stride
        out.extend(arr.tobytes())
        views.append(view)
        return len(views) - 1

    def add_accessor(view, comp, count, kind, normalized=False, lo=None, hi=None):
        acc = {'bufferView': view, 'componentType': comp, 'count': count, 'type': kind}
        if normalized:
            acc['normalized'] = True
        if lo is not None:
            acc['min'], acc['max'] = lo, hi
        accessors.append(acc)
        return len(accessors) - 1

    def copy(index):
        """Carries an accessor over unchanged (images, matrices, anything not repacked)."""
        acc = dict(doc['accessors'][index])
        arr = accessor_array(doc, bin_, index)
        acc['bufferView'] = add_view(np.ascontiguousarray(arr))
        acc.pop('byteOffset', None)
        accessors.append(acc)
        return len(accessors) - 1

    skins = {n['skin'] for n in doc['nodes'] if 'mesh' in n and 'skin' in n}
    if len(skins) != 1:
        raise SystemExit(f'expected every mesh on one skin, found skins {sorted(skins)}')

    prims = [p for m in doc['meshes'] for p in m['primitives']]
    scale = max(float(np.abs(accessor_array(doc, bin_, p['attributes']['POSITION'])).max()) for p in prims)

    for p in prims:
        attrs = p['attributes']
        pos = accessor_array(doc, bin_, attrs['POSITION']).astype(np.float64)
        q = np.round(pos / scale * 32767).clip(-32767, 32767).astype(np.int16)
        q4 = np.zeros((len(q), 4), np.int16)
        q4[:, :3] = q
        attrs['POSITION'] = add_accessor(add_view(q4, 34962, 8), 5122, len(q), 'VEC3', True, [float(x) for x in q.min(0)], [float(x) for x in q.max(0)])

        n = accessor_array(doc, bin_, attrs['NORMAL']).astype(np.float64)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        n4 = np.zeros((len(n), 4), np.int8)
        n4[:, :3] = np.round(n * 127).clip(-127, 127)
        attrs['NORMAL'] = add_accessor(add_view(n4, 34962, 4), 5120, len(n), 'VEC3', True)

        uv = accessor_array(doc, bin_, attrs['TEXCOORD_0']).astype(np.float64)
        # A texel's grace at 1024 px: one vertex here sits at -0.0003, from
        # the exporter's rounding, and clamping it moves nothing visible.
        if uv.min() < -1e-3 or uv.max() > 1 + 1e-3:
            raise SystemExit('UVs outside [0, 1] cannot be stored as normalised integers')
        uq = np.round(uv.clip(0, 1) * 65535).astype(np.uint16)
        attrs['TEXCOORD_0'] = add_accessor(add_view(uq, 34962, 4), 5123, len(uq), 'VEC2', True)

        w = accessor_array(doc, bin_, attrs['WEIGHTS_0']).astype(np.float64)
        w /= np.maximum(w.sum(1, keepdims=True), 1e-12)
        wq = np.floor(w * 255).astype(np.int64)
        short = 255 - wq.sum(1)
        wq[np.arange(len(wq)), np.argmax(w, 1)] += short  # exact sums: no drift at the joints
        attrs['WEIGHTS_0'] = add_accessor(add_view(wq.astype(np.uint8), 34962, 4), 5121, len(wq), 'VEC4', True)

        attrs['JOINTS_0'] = copy(attrs['JOINTS_0'])
        for key in list(attrs):
            if key not in ('POSITION', 'NORMAL', 'TEXCOORD_0', 'WEIGHTS_0', 'JOINTS_0'):
                del attrs[key]
        idx = accessor_array(doc, bin_, p['indices']).ravel()
        small = idx.max() < 65535
        idx = idx.astype(np.uint16 if small else np.uint32)
        p['indices'] = add_accessor(add_view(idx, 34963), 5123 if small else 5125, len(idx), 'SCALAR')

    skin = doc['skins'][skins.pop()]
    ibm = accessor_array(doc, bin_, skin['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4)
    # glTF matrices are column-major: element [c][r]. Scaling the columns 0–2
    # multiplies each matrix by diag(scale, scale, scale, 1) on the right.
    ibm[:, :3, :] *= scale
    skin['inverseBindMatrices'] = add_accessor(add_view(ibm.astype(np.float32).reshape(-1, 16)), 5126, len(ibm), 'MAT4')

    for image in doc.get('images', []):
        if 'bufferView' in image:
            view = doc['bufferViews'][image['bufferView']]
            raw = np.frombuffer(bin_, np.uint8, view['byteLength'], view.get('byteOffset', 0))
            image['bufferView'] = add_view(raw.copy())

    doc['accessors'] = accessors
    doc['bufferViews'] = views
    doc['buffers'] = [{'byteLength': len(out)}]
    for key in ('extensionsUsed', 'extensionsRequired'):
        doc[key] = sorted(set(doc.get(key, [])) | {'KHR_mesh_quantization'})
    for m in doc.get('materials', []):
        if m.get('name') in opaque:
            m.pop('alphaMode', None)

    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(out) % 4:
        out.append(0)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(out), 0x004E4942) + bytes(out))
    return total


if __name__ == '__main__':
    print(quantize_skinned(sys.argv[1], sys.argv[2]), 'bytes')
