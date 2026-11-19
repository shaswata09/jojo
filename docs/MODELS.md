# Connecting a model and the document reader

jojo tracks applications with no model at all. A model adds the assistant, Job Scout,
"Ask the graph" and fit scoring. The document reader (MarkItDown) lets the assistant
read PDFs, Word files and decks. Both are optional, and both are set up in **Settings**.
Type `model` or `documents` into the search bar to jump straight to the right card.

| You want                                | Use                                     | Leaves your machine? | Costs        |
| --------------------------------------- | --------------------------------------- | -------------------- | ------------ |
| Everything private, on a laptop or Mac  | [Ollama](#ollama)                       | No                   | Nothing      |
| A GUI that downloads models for you     | [LM Studio](#lm-studio)                 | No                   | Nothing      |
| The fastest local serving, NVIDIA GPU   | [vLLM](#vllm)                           | No                   | Nothing      |
| One binary, any GGUF file               | [llama.cpp](#llamacpp)                  | No                   | Nothing      |
| The agentic half with no GPU or card    | [NVIDIA build.nvidia.com](#nvidia)      | Yes                  | Free, rate-limited |
| Claude                                  | [Anthropic](#anthropic-claude)          | Yes                  | Per token    |
| GPT models                              | [OpenAI](#openai)                       | Yes                  | Per token    |
| Many vendors behind one key             | [OpenRouter](#openrouter)               | Yes                  | Per token    |
| Very fast open-weight models            | [Groq](#groq)                           | Yes                  | Per token    |

With a cloud provider, your prompts go to that provider, along with the records the
assistant reads while it answers. Your API key is stored beside the graph, never inside
it, so a backup file cannot carry it.

## The same four steps for every provider

1. Open **Settings → Model** and pick the **Provider**.
2. Fill in **Endpoint** for a local server, or **API key** for a cloud one.
3. Press **Test connection**. A green **Connected** chip means jojo reached the server,
   and the **Model** field fills in with what the server reported. If your server serves
   more than one model, change the field.
4. Optionally, give the connection a name under **Saved as**. Saved connections are
   remembered whole (provider, address, model and key), so next time you pick one from
   the list.

The assistant works by calling tools (reading a record, adding a date, and so on), so
**the model must support tool calling**. Every cloud model named below does. Locally,
pick a model that lists "tools" on its card. Qwen3, gpt-oss, Llama 3.1+ and Gemma 4 all
work. **Reasoning** (in the same card) lets thinking models reason before answering;
turn it off if a small model returns empty replies.

---

## Local models

### Ollama

The default, and the simplest.

```bash
# macOS / Windows: install the app from https://ollama.com/download
# Linux:
curl -fsSL https://ollama.com/install.sh | sh

ollama pull qwen3:8b        # ~5 GB; tools + thinking. gpt-oss:20b if you have 16 GB+ free
ollama serve                # the desktop app already does this; skip if it is running
curl http://localhost:11434/api/version   # check: prints {"version":"…"}
```

In jojo: **Provider → Ollama**, **Endpoint** `http://localhost:11434` (**no `/v1`**: jojo
uses Ollama's own API so that it can set the context size), then **Test connection**.

- **Context window.** Leave it empty and Ollama sizes the context itself, while jojo
  plans each request around 32,768 tokens. Type a number and it is also sent to Ollama
  as `num_ctx`. On a machine short of memory, set a smaller number before reaching for a
  smaller model.
- **Browser access.** Ollama accepts pages served from `localhost` and `127.0.0.1` on
  any port, which covers `npm run dev` and `npm run preview`. A copy of jojo served from
  any other origin must be added explicitly, for example
  `OLLAMA_ORIGINS=https://jojo.example.com ollama serve`.

### LM Studio

1. Install from <https://lmstudio.ai>, then download a model with tool support from the
   **Discover** tab (for example Qwen3 8B).
2. Go to **Developer**, load the model, turn on **Enable CORS** in the server settings,
   and start the server. From a terminal, `lms server start --cors` does the same.
3. In jojo: **Provider → A local server (vLLM, LM Studio, llama.cpp)**, **Endpoint**
   `http://localhost:1234/v1`, then **Test connection**.

CORS has to be on for the web app, because the page (port 5173) and the server (port
1234) are different origins. The phone app does not need it.

### vLLM

For a Linux machine with an NVIDIA GPU. vLLM only returns tool calls when it is told how
to parse them, and **without the two tool flags the assistant can talk but cannot act**.

```bash
pip install vllm
vllm serve Qwen/Qwen3-8B \
  --port 8000 \
  --max-model-len 32768 \
  --enable-auto-tool-choice --tool-call-parser hermes
```

Or with Docker:

```bash
docker run --gpus all -p 8000:8000 --ipc=host vllm/vllm-openai \
  --model Qwen/Qwen3-8B --max-model-len 32768 \
  --enable-auto-tool-choice --tool-call-parser hermes
```

Pick the parser that matches the model family: `hermes` for Qwen, `llama3_json` for
Llama 3.1 and later, `mistral` for Mistral, `openai` for gpt-oss.

In jojo: **Provider → A local server (vLLM, LM Studio, llama.cpp)**, **Endpoint**
`http://<that machine>:8000/v1`, then **Test connection**. vLLM allows every origin by
default, so the web app needs no CORS flag.

### llama.cpp

```bash
brew install llama.cpp            # or a release from github.com/ggml-org/llama.cpp
llama-server -hf ggml-org/gpt-oss-20b-GGUF --jinja -c 32768 --port 8080
```

`--jinja` is what makes tool calls work. In jojo: **A local server (vLLM, LM Studio,
llama.cpp)** with **Endpoint** `http://localhost:8080/v1`.

### From the phone

On a phone, `localhost` means the phone itself, and jojo warns if you type it there.
Run the server on your computer, make it listen on the network, and type the computer's
address instead (for example `http://192.168.1.20:11434`). Both devices must be on the
same Wi-Fi network.

| Server    | Listen on the network                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Ollama    | `OLLAMA_HOST=0.0.0.0 ollama serve`. With the macOS app: `launchctl setenv OLLAMA_HOST 0.0.0.0`, then restart Ollama. |
| LM Studio | **Developer → Settings → Serve on Local Network**                                                               |
| vLLM      | `--host 0.0.0.0`                                                                                                |
| llama.cpp | `--host 0.0.0.0`                                                                                                |

The phone app may talk plain `http://` to an address you typed; jojo never chooses one
for you.

---

## Cloud models

Each needs an API key, pasted into **API key**. The endpoint is fixed, so there is
nothing else to fill in. Press **Test connection**, and the **Model** field fills in
where the provider lists its models. Otherwise, type the id.

### NVIDIA

**build.nvidia.com: free, rate-limited.** It is the way to try the agentic half without a
GPU or a card.

1. Sign in at <https://build.nvidia.com/> and generate a key (`nvapi-…`).
2. **Provider → NVIDIA (build.nvidia.com) — free, rate limited**, paste the key, and test.
3. Model: for example `nvidia/nemotron-3-ultra-550b-a55b`, or any chat model in their
   catalogue.

NVIDIA's trial terms are for evaluation, and jojo shows them next to the key.

### Anthropic (Claude)

1. Create a key at <https://console.anthropic.com/settings/keys> (`sk-ant-…`). API use is
   billed per token to the Console account, separately from any Claude.ai plan.
2. **Provider → Anthropic (Claude)**, paste the key, and test.
3. Model: `claude-sonnet-5-5` is a good default, `claude-haiku-5-5` is cheaper and
   faster, and `claude-opus-5-5` is the most capable.

The web app calls Anthropic directly from the page. The key goes nowhere else.

> **A Claude Pro or Max subscription is not an API key**, and it cannot be used as a jojo
> provider. If you already pay for one, let **Claude Code** drive jojo instead. Turn on
> **Settings → Connect from an MCP client** and run the two commands it shows (they
> start `jojo-bridge` and register it with `claude mcp add`). Claude Code then works on
> your records with its own model, through the same tools, with the same undo. See
> "Letting your own assistant use jojo" in the README.

### OpenAI

1. Create a key at <https://platform.openai.com/api-keys> (`sk-…`).
2. **Provider → OpenAI**, paste the key, and test.
3. Model: for example `gpt-4o`, or any chat model your key can use.

### OpenRouter

One key for many vendors' models.

1. Create a key at <https://openrouter.ai/keys> (`sk-or-…`).
2. **Provider → OpenRouter**, paste the key, and test.
3. Model: a `vendor/model` id, for example `meta-llama/llama-3.3-70b-instruct`. Choose one
   whose page lists *tools* among its supported parameters.

### Groq

1. Create a key at <https://console.groq.com/keys> (`gsk_…`).
2. **Provider → Groq**, paste the key, and test.
3. Model: for example `llama-3.3-70b-versatile`.

---

## The document reader: MarkItDown

[MarkItDown](https://github.com/microsoft/markitdown) (Microsoft, MIT) turns PDFs, Word
files, decks and spreadsheets into text the assistant can read. jojo talks to it through
its MCP server. It runs on your machine, and documents go to it and nowhere else.

```bash
pip install markitdown-mcp                              # Python 3.10+
markitdown-mcp --http --host 127.0.0.1 --port 3001
```

Leave that terminal open. Then open **Settings → Read my documents** and press
**Test connection**. **Copy the setup commands** on that card copies the two lines above.

What to put in **Address** depends on how you run jojo:

| Running jojo as                  | Address                         | Why                                                                                                                                                  |
| -------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev -w web` (local)     | `/reader/mcp` (the default)     | `markitdown-mcp` sends no CORS headers, so the page cannot call port 3001 itself. The dev server forwards `/reader` to it.                              |
| A hosted copy (https)            | `http://127.0.0.1:3001/mcp`     | Install the jojo browser extension (**Settings → Keeping postings**). It relays the reader's requests, and only ever to this machine.                |
| The phone app                    | `http://<computer>:3001/mcp`    | The phone calls it directly. Start it with `--host 0.0.0.0` so it can be reached across Wi-Fi.                                                        |

Without the reader, the web app still reads saved pages, `.txt` and `.md` itself, and the
phone also reads DOCX and other archive formats itself. PDFs and scans need MarkItDown.
Files over 8 MB are refused, with a message saying so.

---

## When it does not connect

| You see                                       | Usually                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No answer** from a local server             | The server is not running, the port is wrong, or (in the browser) CORS is off: LM Studio's **Enable CORS**, or `OLLAMA_ORIGINS` for a non-local origin. |
| No answer from the phone                      | The address is `localhost`, the server listens only on `127.0.0.1`, or the phone is on a different network.                                            |
| A 401 or 403 from a cloud provider            | The key was mistyped or revoked, or the account has no credit (OpenAI, Anthropic, OpenRouter, Groq).                                                     |
| The assistant answers but never does anything | The model has no tool support, or vLLM was started without `--enable-auto-tool-choice --tool-call-parser …`.                                            |
| Empty replies from a small local model        | Turn **Reasoning** off for that connection.                                                                                                              |
| Replies cut off, or it forgets the thread     | Ollama: raise **Context window**. vLLM / llama.cpp: raise `--max-model-len` / `-c`.                                                                     |
| The reader fails only on the web              | The address is `http://127.0.0.1:3001/mcp` on the dev server. Use `/reader/mcp`, or install the extension on a hosted copy.                             |
