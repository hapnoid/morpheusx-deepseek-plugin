# MorpheusX Research for DeepSeek Harness

An installable DeepSeek Harness bundle that adds the `morpheusx_research` tool. It searches Google, opens discovered sources in temporary tabs in an existing Chrome/Chromium CDP session, returns bounded page text to the model, and saves complete results as Markdown and JSON.

## Requirements

- DeepSeek Harness (`dsh`) with the plugin bundle system.
- A Chrome/Chromium browser already running with remote debugging enabled on a local CDP endpoint.
- Node.js supported by DeepSeek Harness.

This bundle does not include, install, or launch a browser. It uses `playwright-core`, which has no bundled browser. It only attaches to CDP endpoints bound to localhost. It leaves the browser running and closes only tabs it opened.

## Install

Open a terminal in the extracted bundle or cloned repository directory (the folder containing `package.json`), then run:

```sh
dsh plugin --profile default add .
dsh --profile default --dump-config
```

Replace `default` with the profile you use. The package is also independently installable by packaging this directory as a tarball and adding the tarball to your profile.

## Chrome CDP connection

The plugin checks, in order:

1. `cdpEndpoint`, when configured.
2. CDP ports advertised by running Chrome/Chromium/Edge process arguments (including Chrome's dynamic-port `DevToolsActivePort` file).
3. The configured `candidatePorts` list, which defaults to ports 9222–9230.

Every candidate must answer `/json/version` and return a Chrome-family WebSocket debugger URL. The endpoint must be localhost. If no live CDP endpoint is found, the tool explains how to point `cdpEndpoint` at one; it never starts a replacement browser.

Set `cdpEndpoint` in the inserted plugin row in your profile's `cordis.patch.yml` to a local URL such as `http://127.0.0.1:9222` when automatic discovery cannot find a custom endpoint. Do not expose Chrome's CDP port to the public internet: CDP grants control over the browser session.

## Configure

The inserted row starts with practical defaults. Change values under its `config` in the profile's `cordis.patch.yml`:

- `outputDirectory`: results root (default `morpheusx-results` under the `dsh` working directory).
- `maxPages`, `resultsPerPage`: search breadth.
- `maxConcurrency`: concurrent source tabs, capped at 12.
- `maxSourceCharacters`: saved body-text limit per source.
- `maxReturnedCharacters`: maximum page text returned to the model.
- `blockedDomains`: domains excluded from fetching.
- `pageLoadTimeoutMs`: navigation timeout.
- `candidatePorts`: extra localhost CDP ports to probe.
- `cdpEndpoint`: optional preferred CDP URL.

Each run writes `results.md` and `sources.json` to `<outputDirectory>/<query>/`.

## Use

Ask DeepSeek Harness to research a focused query and cite the returned source URLs. The tool returns source URLs, readable extracted text within its configured model-output budget, counts, and the saved results path. Failed or blocked sources are reported as failures.

If Google displays a CAPTCHA or anti-automation challenge, solve it yourself in the visible Chrome window and retry. The plugin stops instead of trying another network path.
