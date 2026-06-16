# create-agentview

Scaffold a new Agentview app from a bundled template.

## Usage

```bash
npm create agentview@latest my_dir
```

This will copy the bundled `template/` into `my_dir`.

## Publishing (for maintainers)

`npm run build` bundles `dist/template/` from `apps/examples/ai-sdk-demo`:
- excludes `node_modules`, build artifacts, and any `.env*` files except `.env.example`
- adds a `.gitignore`
- rewrites `package.json` (name `my-agentview-app`, version `0.0.1`, `workspace:*`
  deps pinned to the current release version)

This package is published as part of the monorepo release flow (run from the repo
root), which builds and publishes all packages together:

```bash
pnpm release patch   # or minor / major / prerelease <preid>
```

