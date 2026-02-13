---
name: frontend-architecture
description: React SPA architecture rules. Covers stack, folder structure, TanStack Query, Zustand, React Hook Form + Zod, TanStack Router, Radix UI, Tailwind, auth, testing, and deployment.
---

# Frontend Architecture Rules

## Stack

TypeScript (strict), React 18, Vite 5, TanStack Router, TanStack Query 5, Zustand 5, React Hook Form 7 + Zod, Radix UI, Tailwind CSS 3, Axios, pnpm.

## Structure

```
src/
├── api/
│   ├── client.ts             # Axios instance, auth interceptor, 401 handler
│   └── modules/              # one file per domain: <domain>.api.ts
├── components/
│   ├── ui/                   # Radix UI primitives + Tailwind, no business logic
│   └── shared/               # composed components used across features
├── features/<domain>/
│   ├── components/           # domain-specific UI
│   ├── hooks/                # query/mutation hooks for this domain
│   └── schemas/              # Zod schemas for forms
├── hooks/                    # global reusable hooks
├── routes/                   # TanStack Router file-based routes
│   ├── __root.tsx
│   └── ...
├── store/
│   └── ui.store.ts           # Zustand, UI-only state
├── lib/
│   ├── query-client.ts
│   └── utils.ts
├── types/                    # shared TypeScript types
├── main.tsx
└── App.tsx
```

## State Management Rules

- **TanStack Query** owns all server state: fetched data, loading, error, caching, refetching.
- **Zustand** owns UI-only state: open modals, sidebar, theme — things never sent to the server.
- Never put fetched data into Zustand.
- Never use `useEffect` + `useState` to fetch data. Always use `useQuery`.

## API Layer Rules

- All API calls live in `src/api/modules/<domain>.api.ts` as plain typed functions using `apiClient`.
- `apiClient` is a single Axios instance with a request interceptor (injects Bearer token) and a response interceptor (handles 401).
- No API calls directly inside components. Components call hooks only.

## Query and Mutation Rules

- Every query lives in a `use<Resource>` hook inside `features/<domain>/hooks/`.
- Every mutation lives in a `use<Action>` hook. On success, invalidate the relevant query keys.
- `queryKey` arrays always start with the resource name string: `['items']`, `['items', id]`.
- Configure `QueryClient` defaults: `staleTime: 60000`, `retry: 1`, `refetchOnWindowFocus: true`.

## Zustand Rules

- One store file per concern. Keep stores small and focused.
- Components always subscribe via selectors: `useStore(s => s.field)` — never destructure the whole store.
- No async logic in Zustand actions. Async belongs in TanStack Query mutations.

## Form Rules

- All forms use React Hook Form with `zodResolver`.
- Define the Zod schema first, infer the TypeScript type from it with `z.infer<typeof schema>`.
- Schema files live in `features/<domain>/schemas/`.
- Use uncontrolled inputs via `form.register()`. Avoid controlled inputs unless unavoidable.

## Routing Rules

- File-based routes under `src/routes/`. Dynamic segments use `$param` naming.
- Root layout in `__root.tsx`. Pass `queryClient` as router context.
- Use route loaders with `queryClient.ensureQueryData()` to prefetch data before the component renders.
- Navigate programmatically with `useNavigate`. All navigation is type-safe.

## Component Rules

- `components/ui/` — unstyled Radix primitives wrapped with Tailwind. Use `class-variance-authority` for multi-variant components. Zero business logic.
- `components/shared/` — composed components used in more than one feature.
- `features/*/components/` — domain-specific components. May use feature hooks and the UI store.
- Never import from one feature's folder into another feature's folder. Promote to `shared/` if reuse is needed.

## Styling Rules

- Tailwind only. No inline styles, no CSS modules.
- Define design tokens (colors, radius, spacing) in `tailwind.config.ts`. Reference them as utility classes.
- Use `cn()` (clsx + tailwind-merge) for conditional class composition.

## Auth Rules

- Auth is handled by the backend OIDC provider at `/idp/*`.
- Unauthenticated users are redirected to `/idp/auth` (or `/login` which redirects there).
- Token is stored in localStorage and injected by the Axios request interceptor.
- An `AuthGuard` component wraps protected routes and redirects to login if no token is present.
- On 401 response, the Axios response interceptor clears the token and redirects to login.

## Vite Rules

- Dev server proxies `/api/*` and `/idp/*` to `http://localhost:3000` — no CORS handling needed locally.
- Path alias `@` maps to `src/`.
- Include `TanStackRouterVite()` plugin for automatic route tree generation.

## Testing Rules

- No unit tests. Testing is optional and non-blocking.
- If tests are added: Vitest + React Testing Library + MSW for network-level API mocking.
- Tests run in CI on demand. Not part of any commit hook.

## Deployment Rules

- Multi-stage Dockerfile: base → deps → build → runner (nginx:alpine).
- `VITE_API_URL` is a Docker build ARG — it is baked into the bundle at build time.
- The final container is Nginx serving the static dist folder. No Node.js at runtime.
- `nginx-spa.conf` uses `try_files $uri $uri/ /index.html` to support client-side routing.
