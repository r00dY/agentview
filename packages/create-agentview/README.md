# create-agentview

Scaffold a new Agentview app from a bundled template.

## Usage

```bash
npm create agentview@latest my_dir
```

This will copy the bundled `template/` into `my_dir`.

## Publishing (for maintainers)

The `publish` script will:
- Build the `template/` from `apps/studio` (excluding node_modules, .react-router, and common build artifacts)
- Set the template `package.json` name to `my-agentview-app` and version to `0.0.1`
- Publish the package to npm

```bash
cd packages/create-agentview
npm run publish
```

