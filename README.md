# MorpheusX Research for DeepSeek Harness

An installable DeepSeek Harness bundle that adds the `morpheusx_research` tool. It searches Google, opens discovered sources in temporary tabs in an existing Chrome/Chromium CDP session, returns bounded page text, and saves results as Markdown and JSON.

## Install from the DeepSeek Desktop plugin manager

The plugin manager accepts an npm package name, a GitHub repository address, or a local directory. Enter one of these values in its plugin/package field:

- **GitHub repository:** `https://github.com/hapnoid/morpheusx-deepseek-plugin` (or `github:hapnoid/morpheusx-deepseek-plugin`). The repository must be public for GitHub installation.
- **Local directory:** the full path to the extracted or cloned folder that contains `package.json`, for example `C:\Users\you\Downloads\MorpheusX-DeepSeek-Plugin`.
  Before entering a local folder, open a terminal in it and run `pnpm install --prod --ignore-scripts --config.auto-install-peers=false`. Local links keep dependencies in the plugin folder.
- **npm package name:** `dsh-morpheusx-research` after it has been published to npm. This repository does not currently publish an npm package, so entering only the package name will show `No such plugin was found` until it is published.

The **Custom address** field is for an npm-compatible registry URL, not a GitHub repository URL.

## Install from a terminal

Open a terminal in the extracted or cloned repository directory (the folder containing `package.json`), then run:

```sh
dsh plugin --profile default add .
dsh --profile default --dump-config
```

For a GitHub source, use `dsh plugin --profile default add github:hapnoid/morpheusx-deepseek-plugin`. Replace `default` with the profile you use.

## Requirements and browser connection

- DeepSeek Harness with the plugin bundle system, plus Node.js supported by DeepSeek Harness.
- A Chrome/Chromium/Edge browser already running with remote debugging enabled on a local CDP endpoint.
- This plugin uses `playwright-core` and does not include, install, or launch a browser. It attaches only to localhost CDP endpoints, leaves the existing browser running, and closes only the tabs it opened.

The plugin checks an explicitly configured `cdpEndpoint` first, then running browser process arguments (including Chrome's dynamic-port `DevToolsActivePort` file), then configured candidate ports (9222–9230 by default). If discovery cannot find your endpoint, set `cdpEndpoint` in the plugin config to a local URL such as `http://127.0.0.1:9222`. Never expose the CDP port to the public internet: it grants control over the browser session.

## Configure and use

Configure `outputDirectory`, `maxPages`, `resultsPerPage`, `maxConcurrency` (capped at 12), `maxSourceCharacters`, `maxReturnedCharacters`, `blockedDomains`, `pageLoadTimeoutMs`, `candidatePorts`, and `cdpEndpoint` in the inserted plugin row in your profile's `cordis.patch.yml`. Each run writes `results.md` and `sources.json` under `<outputDirectory>/<query>/`.

Ask DeepSeek Harness to research a focused query and cite the returned source URLs. CAPTCHA and anti-automation challenges are reported for you to resolve in the visible Chrome window; the plugin stops instead of trying another network path.
