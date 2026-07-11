# Contributing / Development

```sh
git clone https://github.com/freedomgd/MR-Behavior-Lens.git
cd MR-Behavior-Lens
npm install
npm run compile
```

Open the folder in VSCode and press **F5** (Run Extension) to launch an Extension Development Host.

Useful scripts:

- `npm run compile` — typecheck + bundle with esbuild
- `npm run watch` — rebuild on change
- `npm run typecheck` — typecheck only

To build a local package: `npx @vscode/vsce package`
