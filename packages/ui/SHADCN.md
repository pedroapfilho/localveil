# Shared components

`src/components` contains the configured shadcn Base UI registry modules. Preserve upstream exports, props/defaults, DOM semantics and interactions. Product-specific UI belongs in `src/compositions`: FileDropzone handles file picking and FractionProgress adapts the product’s 0–1 progress values to the registry’s 0–100 API. Variant factories are exported beside the component; import `toast` directly from Sonner.

Product branding stays in `src/styles/globals.css`, which loads `shadcn/tailwind.css`. All six design-system lint rules apply to registry modules. Equivalent named tokens replace arbitrary registry values; the Toaster utility owns its CSS variables. Dropdown menu popups share a private primitive implementation to preserve upstream submenus without restyling a public component. Formatting, declaration ordering, typed conditions and imports follow repository conventions.

`shadcn.lock.json` records the upstream reference, registry payload hashes, reviewed source hashes and required CSS declarations. `pnpm check:shadcn` rejects changed/missing primitives, unregistered modules and missing CSS declarations. Brand tokens remain outside the lock.

For registry updates, review the upstream change and equivalent normalizations, migrate callers, then run lint, formatting, typechecks, tests and the production build before updating the lock. Do not refresh hashes to bless a product-specific fork.
