"""
Prepares jojo's robot: web/src/assets/jojo-robot.glb, from the artist's model.

The robot is "Sci-fi O.B. Robot Unit TH-ICC02 (animated)" by Jungle Jim,
licensed CC BY 4.0:
  https://sketchfab.com/3d-models/sci-fi-ob-robot-unit-th-icc02-animated-6c0764c2bc4c4aaa8e03ba1653f455a6
  https://sketchfab.com/jungle_jim
  http://creativecommons.org/licenses/by/4.0/

The download is not in the repo (70 MB, and Sketchfab serves it only to a
signed-in account). To regenerate the app's file, download the glTF
("Autoconverted format") zip, unzip it into a folder of its own, and run:

    python -m venv ~/.cache/jojo-robot-venv
    ~/.cache/jojo-robot-venv/bin/pip install bpy numpy
    ~/.cache/jojo-robot-venv/bin/python web/scripts/robot/prepare_model.py \\
        <unzipped>/scene.gltf web/src/assets/jojo-robot.glb

What this changes from the artist's file — CC BY asks that changes be
indicated, and this list is that indication (it is repeated in the app's
credits):

  - removes the bundled 17-second animation clip; the app animates the
    skeleton itself (lib/robot-rig.ts)
  - reduces the mesh from about 125k to about 62k triangles
  - resizes the six 4K textures to 1024 px and stores them as WebP
  - drops the tangent data (three derives it), and stores positions,
    normals, UVs and skin weights as integers (KHR_mesh_quantization, read
    natively by three's loader)
  - marks the body material opaque: the file flags it as blended, but its
    texture has no alpha channel
  - removes a stray 2 m helper sphere left at the origin, and one unused
    morph target (weight 0) on each part
  - adds an empty, "pivots", recording where each joint the app turns
    really is (the skin data parks the arm bones at the origin — see
    `record_pivots`)
  - adds one empty, "eyes", on the head bone at the front of the visor, which
    the app hangs its drawn eyes from; the visor's curvature and lean are
    measured here and carried on it (`visor_radius_x`, `visor_tilt`)

The model, its proportions, its colours and its rig are the artist's.
"""

from __future__ import annotations

import argparse
import math

import bpy
from mathutils import Matrix, Vector

HEAD = 'CC_Base_Head_033'

# The joints the app turns (lib/robot-rig.ts, BONE_NAMES). Their true pivots
# are recorded here — see `record_pivots`.
DRIVEN = (
    'CC_Base_Hip_02',
    'CC_Base_Waist_028',
    'CC_Base_Spine02_030',
    'CC_Base_NeckTwist01_031',
    'CC_Base_Head_033',
    'CC_Base_L_Clavicle_044',
    'CC_Base_L_Upperarm_046',
    'CC_Base_L_Forearm_047',
    'CC_Base_L_Hand_051',
    'CC_Base_R_Clavicle_061',
    'CC_Base_R_Upperarm_062',
    'CC_Base_R_Forearm_065',
    'CC_Base_R_Hand_070',
)
# Eye height above the head bone: the middle of the visor, just above where it
# faces straight ahead (ray casts: its normal turns from downward to upward
# 6–7 cm above the bone). 3.5 cm, the first guess, sat on the slope toward the
# chin and read as eyes at the nose (owner, 2026-11-15). The rig's eye bones
# sit at the origin in its rest pose, so they cannot be used as a guide.
EYE_RISE = 0.08
TEXTURE_PX = 1024
DECIMATE = 0.5


def armature():
    return next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def drop_strays():
    """Removes meshes the skeleton does not drive — the file carries a 2 m helper sphere at the origin."""
    for o in meshes():
        if not any(m.type == 'ARMATURE' for m in o.modifiers):
            print('  removing stray mesh', o.name)
            bpy.data.objects.remove(o)


def record_pivots():
    """
    Writes where each driven joint really is onto an empty, `pivots`.

    The rig's skin data places its upper-arm and forearm bones at the origin:
    they carry no skin weights (the twist bones under them do), so their
    bind matrices are placeholders, and Blender — which rebuilds the rest
    skeleton from those matrices — exports them there. Turned about the
    origin, an arm swings round the robot's feet and its blended vertices
    stretch into spikes (measured in the app). The artist's own pose, frame 0
    of the bundled clip, has every joint where it belongs and draws the mesh
    exactly as its bind pose does, so the pivots are read from it, in glTF's
    frame (x, z, −y), and the app turns each bone about its own.
    """
    scene = bpy.context.scene
    scene.frame_set(0)
    bpy.context.view_layer.update()
    arm = armature()
    pivots = bpy.data.objects.new('pivots', None)
    scene.collection.objects.link(pivots)
    for name in DRIVEN:
        at = arm.matrix_world @ arm.pose.bones[name].head
        pivots[name] = [round(at.x, 5), round(at.z, 5), round(-at.y, 5)]


def strip_animation():
    for o in bpy.context.scene.objects:
        if o.animation_data:
            o.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    # Back to the rig's rest pose: with the clip gone, nothing else sets it.
    for pb in armature().pose.bones:
        pb.matrix_basis.identity()


def decimate():
    for o in meshes():
        bpy.context.view_layer.objects.active = o
        if o.data.shape_keys:
            # One unused morph target per part ("target_0", weight 0), an
            # export leftover; the basis shape is kept exactly.
            o.shape_key_clear()
        mod = o.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = DECIMATE
        mod.use_collapse_triangulate = True
        # Before the armature modifier, so it reduces the bind-pose mesh and
        # carries the skin weights with it.
        while o.modifiers.find('decimate') > 0:
            bpy.ops.object.modifier_move_up(modifier='decimate')
        bpy.ops.object.modifier_apply(modifier='decimate')


def shrink_textures():
    for img in bpy.data.images:
        if img.size[0] > TEXTURE_PX:
            img.scale(TEXTURE_PX, TEXTURE_PX)


def visor_anchor():
    """Finds the front of the visor between the eye bones, and its curvature."""
    arm = armature()
    dg = bpy.context.evaluated_depsgraph_get()
    mid = arm.matrix_world @ arm.pose.bones[HEAD].head + Vector((0.0, 0.0, EYE_RISE))

    def front(x, z):
        # Blender looks down +y; the robot faces -y. Cast from in front, toward it.
        hit, at, *_ = bpy.context.scene.ray_cast(dg, Vector((x, -3.0, z)), Vector((0.0, 1.0, 0.0)))
        return at if hit else None

    centre = front(mid.x, mid.z)
    if centre is None:
        raise SystemExit('no visor in front of the head bone')
    d = 0.06
    side = front(mid.x + d, mid.z)
    up = front(mid.x, mid.z + d)
    # How far the glass leans back: the drawn eyes are tipped to match, so
    # neither their top nor their bottom edge sinks behind it.
    hi, lo = front(mid.x, mid.z + 0.03), front(mid.x, mid.z - 0.03)
    tilt = math.atan2(hi.y - lo.y, 0.06)
    # Sagitta: how far the surface falls back over a chord gives its radius.
    sag_x = side.y - centre.y
    sag_y = up.y - centre.y
    radius_x = (d * d + sag_x * sag_x) / (2 * sag_x) if sag_x > 1e-5 else 10.0
    radius_y = (d * d + sag_y * sag_y) / (2 * sag_y) if sag_y > 1e-5 else 10.0

    e = bpy.data.objects.new('eyes', None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = arm
    e.parent_type = 'BONE'
    e.parent_bone = HEAD
    bpy.context.view_layer.update()
    # Placed in world space after parenting, so Blender works out the offset
    # from the bone (which bone parenting measures from the bone's tail).
    e.matrix_world = Matrix.Translation(centre)
    e['visor_radius_x'] = round(radius_x, 4)
    e['visor_radius_y'] = round(radius_y, 4)
    e['visor_tilt'] = round(tilt, 4)
    print(f'  visor front {tuple(round(v, 4) for v in centre)}; radius x {radius_x:.3f}, y {radius_y:.3f}; tilt {math.degrees(tilt):.1f}°')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    a = ap.parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.src)
    drop_strays()
    before = sum(len(o.data.polygons) for o in meshes())
    record_pivots()
    strip_animation()
    bpy.context.view_layer.update()
    visor_anchor()
    decimate()
    after = sum(len(o.data.polygons) for o in meshes())
    shrink_textures()
    print(f'  triangles {before} → {after}')

    bpy.ops.export_scene.gltf(
        filepath=a.dst,
        export_format='GLB',
        export_image_format='WEBP',
        export_image_quality=82,
        export_tangents=False,
        export_animations=False,
        export_skins=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        use_selection=False,
    )
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from quantize import quantize_skinned

    # Body3 is marked BLEND, but its texture has no alpha channel (checked:
    # RGB): opaque, without the sorting glitches blending brings.
    print('wrote', a.dst, quantize_skinned(a.dst, a.dst, opaque=('Body3',)), 'bytes (quantized)')


if __name__ == '__main__':
    main()
