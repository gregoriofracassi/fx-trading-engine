---
name: backend-architecture
description: NestJS modular monolith architecture rules. Covers stack, folder structure, CQRS, DDD patterns, repository, database, events, BullMQ, auth, exceptions, DTOs, testing, git hooks, and deployment.
---

# Backend Architecture Rules

## Stack

Node.js 22+, TypeScript (strict), NestJS 10, Prisma 5, PostgreSQL 16, BullMQ + Redis, JWT + OIDC Provider, class-validator, Swagger, Jest, pnpm, Turbo.

## Structure

One NestJS process. One PostgreSQL database. All domains live under `src/modules/<domain>/`. Shared infrastructure lives in `src/common/`.

```
src/
├── modules/<domain>/
│   ├── commands/impl/        # command classes
│   ├── commands/handlers/    # @CommandHandler
│   ├── commands/dto/
│   ├── queries/impl/         # query classes
│   ├── queries/handlers/     # @QueryHandler
│   ├── queries/dto/
│   ├── domain/models/        # aggregate root
│   ├── domain/repositories/  # only place Prisma is used
│   ├── domain/repositories/helpers/  # Prisma → domain mapping
│   ├── domain/services/      # orchestration
│   ├── domain/factories/     # aggregate construction
│   ├── domain/events/        # event classes + handlers
│   ├── domain/sagas/         # event-driven workflows
│   ├── domain/enums/
│   ├── controllers/
│   ├── dto/requests/
│   ├── dto/responses/
│   ├── exceptions/
│   └── <domain>.module.ts
├── common/auth/
├── common/guards/
├── common/filters/
├── common/pipes/
├── common/decorators/
├── database/                 # PrismaService + schema.prisma
├── queue/                    # BullMQ module + processors
└── app.module.ts
```

## Module Rules

- Each module is a fully self-contained vertical slice. It owns its own domain model, persistence, HTTP layer, and events.
- Modules never import each other's internal classes. Cross-module calls go through a public service interface or via the EventBus.
- Cross-module DB references use plain string IDs — no cross-schema joins.

## Service Rules

- Services live in `domain/services/` and are plain `@Injectable()` classes.
- Use a service when logic is too complex or reusable to live in a single handler, or when a controller needs to call a reusable function directly without going through the command/query bus.
- Services may be injected into command handlers, query handlers, or controllers within the same module.
- Services may call repositories and other services within the same module. They must never import from another module's internals — use the EventBus for cross-module communication.
- Infrastructure-wrapping services (e.g. third-party API clients) may live at the module root (e.g. `apify.service.ts`) rather than in `domain/services/` when they are primarily adapters rather than domain logic.
- Never put Prisma types or HTTP types inside a service.

## CQRS Rules

- Every state-mutating operation is a Command. Every read is a Query.
- Commands and Queries are plain classes with no methods — just constructor data.
- Handlers contain all logic. Controllers only dispatch to the bus and return the result.
- Query handlers go directly to the repository. They do not touch the domain model.
- Never put business logic in a controller.

## Domain Model Rules

- Aggregate roots extend `AggregateRoot` from `@nestjs/cqrs`.
- All fields are private using `#field` syntax. Expose via getters only.
- State changes only through named methods that encode the business rule.
- Never put Prisma types, HTTP types, or request/response DTOs inside a domain model.
- Domain models throw domain-specific exceptions when invariants are violated.

## Repository Rules

- Repositories are the only place `PrismaService` is injected and used.
- Every repository method maps Prisma records to domain models via a helper function in `helpers/`.
- Domain models are never returned raw from the database — always map first.
- Query handlers that only need plain data (no domain behavior) may return mapped plain objects directly.

## Database Rules

- Single PostgreSQL instance. One schema per module using Prisma `multiSchema` preview feature.
- Every model and enum declares `@@schema("module_name")`.
- No cross-schema foreign keys. Reference other modules by storing their ID as a plain string.
- Run migrations with `pnpm prisma migrate dev`, generate client with `pnpm prisma generate`.

## Events Rules

- Domain events are dispatched in-process via the NestJS `EventBus` — no external broker.
- Events are published from command handlers after state is persisted, using `eventPublisher.mergeObjectContext()` + `.apply()` + `.commit()`.
- Event handlers only handle side effects (enqueue jobs, notify other modules). They never modify the entity that originated the event.
- Multiple modules may register handlers for the same event.

## Saga Rules

- Sagas are RxJS-based listeners that react to domain events and dispatch new commands. They live in `domain/sagas/`.
- Use a saga when a business process spans multiple steps that each produce their own events — e.g. something happens → trigger action A → on A's completion trigger action B.
- For simple single-step side effects (send an email, enqueue a job), use a plain `@EventsHandler` instead. Sagas are only for multi-step coordinated flows.
- A saga receives an `Observable<IEvent>`, filters for the events it cares about, and returns an `Observable<ICommand>`. The returned commands are automatically dispatched by the framework.
- Sagas are stateless. They do not hold or mutate data — they only observe events and produce commands.
- If a saga step fails, it does not automatically roll back previous steps. Design compensating commands explicitly if rollback is required.

## Background Jobs Rules

- Use BullMQ for anything that must not block the HTTP request cycle: emails, webhooks, external API calls, file processing.
- Always configure `attempts`, `backoff`, and `removeOnComplete` on jobs.
- Processors live in `src/queue/` or inside the relevant module's folder.

## Auth Rules

- All protected routes use `@UseGuards(JwtAuthGuard)`.
- JWTs are validated via JWKS. The OIDC Provider serves `/idp/*` endpoints.
- The JWT strategy validates the token and returns a typed user object (`userId`, `roles`) attached to the request.

## Exception Rules

- Every domain failure is a named exception class extending `Error`, with `this.name` set to the class name.
- Exception classes live in `exceptions/` inside the module.
- One global `ApplicationExceptionFilter` maps exception names to HTTP status codes.
- Never throw NestJS `HttpException` subclasses from inside domain or service layers.

## DTO Rules

- Request DTOs use `class-validator` decorators and `@ApiProperty()` for every field.
- Response DTOs are plain classes or interfaces — never return raw domain models or Prisma records from controllers.
- Register globally: `ValidationPipe({ whitelist: true, transform: true })`.

## Testing Rules

- E2E tests only. No unit tests.
- Tests use Supertest against a real NestJS app instance with a real test database.
- Tests are optional and non-blocking. They run in CI, not on commit.

## Git Hooks Rules

- Husky + Commitlint enforcing conventional commits: `<type>(<scope>): <description>`.
- Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.
- pre-commit runs Prettier on staged files, then `pnpm typecheck` (`tsc --noEmit`) across all packages.
- E2E tests are not part of any commit or push hook.

## Deployment Rules

- Multi-stage Dockerfile with pnpm. Stages: base → deps → build → runner. Use `pnpm deploy --prod` in the build stage and copy the result to the runner to get a flat, correct node_modules.
- docker-compose for local and production: backend, frontend, nginx, postgres, redis.
- **Prisma binaryTargets**: the `schema.prisma` generator must declare `binaryTargets` explicitly. Use `["native", "linux-musl-arm64-openssl-3.0.x"]` for ARM64 hosts (e.g. Apple Silicon dev/local). For x86_64 production servers use `"linux-musl-openssl-3.0.x"` instead. Always add `openssl` via `apk add --no-cache openssl` in the runner stage.
- Nginx proxies `/api/*` and `/idp/*` to backend:3000, everything else to frontend:80.
- Frontend is a static bundle — Nginx serves it directly, no Node.js at runtime.
- Environment variables: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWKS_URI`, `OIDC_COOKIE_KEYS`, `PORT`, `NODE_ENV`, SMTP credentials.
