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
- **Never put Prisma types, HTTP types, or HTTP exceptions inside a service.** A service must not throw `BadRequestException`, `NotFoundException`, or any `HttpException` subclass. Those are HTTP-layer concerns. Services throw domain exceptions (from `exceptions/`) or plain `Error`s. The `ApplicationExceptionFilter` maps them to HTTP responses.
- **Never put input validation in a service.** Validation of incoming request shape (required fields, types, formats) belongs in the DTO layer via `class-validator` decorators. If a service is checking `if (!dto.symbol) throw new BadRequestException(...)`, that logic should be a `@ValidateIf()` on the DTO instead.

## CQRS Rules

- Every state-mutating operation is a Command. Every read is a Query.
- Commands and Queries are plain classes with no methods — just constructor data.
- Handlers contain all logic. Controllers only dispatch to the bus and return the result.
- Query handlers go directly to the repository. They do not touch the domain model.
- **Controllers MUST NOT contain business logic.** Controllers are pure API adapters: validate input via DTOs, dispatch to CommandBus/QueryBus, return result. No loops, no conditionals, no repository calls, no service calls.
- **All POST/PUT/DELETE operations MUST use Commands.** Create a Command class (`commands/impl/`) and CommandHandler (`commands/handlers/`). The controller calls `this.commandBus.execute(new MyCommand(...))`.
- **All GET operations MUST use Queries.** Create a Query class (`queries/impl/`) and QueryHandler (`queries/handlers/`). The controller calls `this.queryBus.execute(new MyQuery(...))`.
- **DTOs are mandatory for request bodies.** Use `@Body() dto: MyDto` with `class-validator` decorators for validation. Never use `@Query()` params for POST requests.
- **Example of correct controller:**
  ```typescript
  @Post('replay-s1-signals')
  async replayS1Signals(@Body() dto: ReplayS1SignalsDto): Promise<ReplayS1SignalsResult> {
    return this.commandBus.execute(new ReplayS1SignalsCommand(dto.symbol));
  }
  ```
- **Example of incorrect controller (business logic in controller):**
  ```typescript
  @Post('replay-s1-signals')
  async replayS1Signals(@Query('symbol') symbol: string) {
    const bars = await this.barRepository.findAll(symbol); // ❌ NO - repository call
    for (const bar of bars) { // ❌ NO - business logic loop
      await this.service.process(bar); // ❌ NO - service call
    }
    return { processed: bars.length };
  }
  ```

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

- Single PostgreSQL instance. Multiple Postgres schemas using Prisma `multiSchema` preview feature — one schema per domain area, not per module.
- Every model declares `@@schema("schema_name")`. Current schemas:
  - `ea_gateway` — raw ingestion data: `AuditEvent`, `BarM15`
  - `strategy` — strategy computation data: `AsiaRange`, future `Signal`, `Zone` etc.
- Adding a new schema: add it to `schemas = [...]` in the datasource block, add `@@schema("name")` to the model, run a migration.
- No cross-schema foreign keys. Reference across schemas by storing the ID as a plain string.
- No redundant `@@index` alongside `@@unique` on the same columns — `@@unique` already creates a B-tree index in Postgres.
- Run migrations: `DATABASE_URL=... pnpm --filter @fx-trading/backend exec prisma migrate dev --name <name> --schema=src/database/schema.prisma`
- Generate client: `DATABASE_URL=... pnpm --filter @fx-trading/backend exec prisma generate --schema=src/database/schema.prisma`

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

### Philosophy

**Domain exceptions are NOT HTTP exceptions.** Domain logic throws semantic errors (`BackfillNotFoundException`, `InvalidBarDataException`) that describe _what went wrong in business terms_. The `ApplicationExceptionFilter` translates these into appropriate HTTP responses.

### Exception Class Pattern

Every domain exception follows this pattern:

```typescript
/**
 * Thrown when [business condition].
 * This indicates [what it means / why it happened].
 */
export class MyDomainException extends Error {
  constructor(
    public readonly contextField1: string,
    public readonly contextField2: number,
  ) {
    super(`Descriptive message with ${contextField1} and ${contextField2}`);
    this.name = 'MyDomainException';
  }
}
```

**Rules**:
- Extend `Error` (never `HttpException`)
- Set `this.name = 'ClassName'` (used by filter for mapping)
- Accept context as constructor parameters (marked `public readonly`)
- Generate descriptive message in `super()`
- Add JSDoc explaining when thrown and what it indicates

### File Structure

```typescript
// src/modules/<module>/domain/exceptions/my-domain.exception.ts
export class MyDomainException extends Error { ... }

// src/modules/<module>/domain/exceptions/index.ts
export { MyDomainException } from './my-domain.exception';
export { AnotherException } from './another.exception';
```

### Global Exception Filter

**File**: `src/common/filters/application-exception.filter.ts`

The global `@Catch()` filter handles ALL exceptions:

1. **NestJS HttpExceptions** (e.g., from guards, pipes, built-in validation) → pass through with original status
2. **Custom domain exceptions** → map `exception.name` to HTTP status via `EXCEPTION_STATUS_MAP`
3. **Unknown errors** → return 500, log full stack trace

**Adding a new exception**:

```typescript
// src/common/filters/application-exception.filter.ts
const EXCEPTION_STATUS_MAP: Record<string, number> = {
  // Module: backtest
  BackfillNotFoundException: 404,
  ChunkValidationException: 400,

  // Module: strategy
  InvalidBarDataException: 422,    // Unprocessable Entity
  InvalidAsiaRangeException: 422,
};
```

**HTTP status code guidelines**:
- `400 Bad Request` — Client sent invalid data (validation, format)
- `404 Not Found` — Resource doesn't exist
- `409 Conflict` — Resource exists but operation conflicts with current state
- `422 Unprocessable Entity` — Request valid but semantically incorrect (e.g., invalid OHLC)
- `500 Internal Server Error` — Unexpected/unknown errors (logged with stack trace)

### Where to Throw Exceptions

| Layer | Can throw | Cannot throw | Example |
|-------|-----------|--------------|---------|
| **Domain/Services** | Custom domain exceptions, plain `Error` | `HttpException` subclasses | `throw new BackfillNotFoundException(symbol)` |
| **Command/Query Handlers** | Custom domain exceptions, plain `Error` | `HttpException` subclasses | `throw new ChunkValidationException(...)` |
| **Controllers** | Nothing (delegates to CommandBus/QueryBus) | Any exception | No throw statements |
| **Guards** | `UnauthorizedException`, `ForbiddenException` (NestJS built-ins OK here) | Custom domain exceptions | `throw new UnauthorizedException()` |
| **Pipes** | `BadRequestException` (NestJS built-in OK here) | Custom domain exceptions | NestJS `ValidationPipe` handles this |

### Response Format

All exceptions return this JSON structure:

```json
{
  "statusCode": 404,
  "error": "BackfillNotFoundException",
  "message": "No active backfill request found for EURUSD. Please trigger a backfill request first."
}
```

**Fields**:
- `statusCode`: HTTP status (from `EXCEPTION_STATUS_MAP` or 500)
- `error`: Exception class name (`exception.name`)
- `message`: Descriptive message (`exception.message`)

### Logging Behavior

The filter logs based on severity:

```typescript
if (status >= 500) {
  this.logger.error(exception.message, exception.stack);  // Full stack trace
}
// Client errors (400, 404, etc.) are NOT logged — expected conditions
```

**Why?**
- 5xx errors = server bugs → need stack traces for debugging
- 4xx errors = client mistakes → expected, no logging pollution

### Example: Complete Exception Flow

**1. Create exception class**:
```typescript
// src/modules/backtest/domain/exceptions/backfill-not-found.exception.ts
export class BackfillNotFoundException extends Error {
  constructor(public readonly symbol: string) {
    super(`No active backfill request found for ${symbol}. Please trigger a backfill request first.`);
    this.name = 'BackfillNotFoundException';
  }
}
```

**2. Register in filter**:
```typescript
// src/common/filters/application-exception.filter.ts
const EXCEPTION_STATUS_MAP: Record<string, number> = {
  BackfillNotFoundException: 404,
};
```

**3. Throw from handler**:
```typescript
// src/modules/backtest/commands/handlers/ingest-historical-chunk.handler.ts
const request = this.backfillStateService.getRequest(symbol);
if (!request) {
  throw new BackfillNotFoundException(symbol);
}
```

**4. Client receives**:
```bash
POST /api/backtest/historical-bars/chunk
# Response: 404
{
  "statusCode": 404,
  "error": "BackfillNotFoundException",
  "message": "No active backfill request found for EURUSD. Please trigger a backfill request first."
}
```

### Never Do This ❌

```typescript
// ❌ WRONG: Throwing HttpException from service
@Injectable()
export class MyService {
  doSomething() {
    if (!found) {
      throw new NotFoundException('Not found');  // ❌ HTTP concern in domain layer
    }
  }
}

// ❌ WRONG: Generic Error without context
throw new Error('Something went wrong');  // ❌ Not semantic, always 500

// ❌ WRONG: Not setting this.name
export class MyException extends Error {
  constructor(msg: string) {
    super(msg);
    // ❌ Missing: this.name = 'MyException';
  }
}
```

### Do This Instead ✅

```typescript
// ✅ CORRECT: Custom domain exception
export class ResourceNotFoundException extends Error {
  constructor(public readonly resourceType: string, public readonly id: string) {
    super(`${resourceType} with ID ${id} not found`);
    this.name = 'ResourceNotFoundException';
  }
}

// Usage
throw new ResourceNotFoundException('BackfillRequest', symbol);

// Registered in filter
const EXCEPTION_STATUS_MAP: Record<string, number> = {
  ResourceNotFoundException: 404,
};
```

### Validation Errors (NestJS Built-in)

**Input validation via `class-validator`** is handled automatically by NestJS `ValidationPipe`:

```typescript
// DTO
export class MyDto {
  @IsString()
  @IsNotEmpty()
  symbol!: string;
}

// Invalid request body
POST /api/endpoint
{ "symbol": "" }

// Automatic response: 400
{
  "statusCode": 400,
  "message": ["symbol should not be empty"],
  "error": "Bad Request"
}
```

**No custom code needed** — NestJS ValidationPipe + ApplicationExceptionFilter handle it automatically.

## DTO Rules

- Request DTOs use `class-validator` decorators and `@ApiProperty()` for every field.
- Response DTOs are plain classes or interfaces — never return raw domain models or Prisma records from controllers.
- Register globally: `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`.
- **`@ValidateIf(o => condition)` for conditional required fields.** When a field is required only for a specific event type or request variant, use `@ValidateIf()` instead of `@IsOptional()`. This keeps the validation contract in the DTO where it belongs, not in the controller or service.

  ```typescript
  const isBarEvent = (o: EaEventDto) => o.type === 'BAR_M15_CLOSED';

  @ValidateIf(isBarEvent)
  @IsString()
  symbol?: string;
  ```

- **`@Transform` for format conversion at the boundary.** If the incoming value needs to be normalised before validation (e.g. a custom date format, a trimmed string, a stringified number), use a `@Transform` decorator — or a reusable custom decorator wrapping it — on the DTO field. This runs during `plainToInstance()` before validators fire. Never do this conversion in the controller or handler.

  ```typescript
  // common/decorators/parse-mt5-date.decorator.ts
  export function ParseMT5Date() {
    return Transform(({ value }) => value != null ? parseMT5Date(value) : value);
  }

  // in DTO:
  @ParseMT5Date()
  @IsDate()
  timeOpen?: Date;
  ```

- **Reusable transform decorators live in `src/common/decorators/`.** Do not inline `@Transform` logic in a DTO if the same transformation is needed in more than one place.
- **Utility functions live in `src/common/utils/`.** Pure functions with no NestJS dependency (e.g. date parsing, string normalisation) live here as plain exported functions. They are imported by decorators, handlers, or services as needed — never defined inside a repository or controller.

## Separation of Concerns — Quick Reference

Each layer has exactly one job. When in doubt, use this table:

| Concern                                     | Where it lives                                               | What it must NOT do                         |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| Input shape & format validation             | DTO (`class-validator`, `@ValidateIf`, `@Transform`)         | Business logic, DB access                   |
| Input format conversion (e.g. date parsing) | `@Transform` decorator in DTO, backed by `src/common/utils/` | Throw HTTP exceptions                       |
| Route handling, response shaping            | Controller                                                   | Validation logic, business logic, DB access |
| Business / domain logic                     | Service (`domain/services/`)                                 | Throw HTTP exceptions, import Prisma types  |
| DB access                                   | Repository (`domain/repositories/`)                          | Business logic, date parsing, HTTP concerns |
| Cross-cutting utilities (pure functions)    | `src/common/utils/`                                          | NestJS dependencies, side effects           |
| Reusable decorator factories                | `src/common/decorators/`                                     | Business logic                              |
| HTTP→domain exception mapping               | `ApplicationExceptionFilter`                                 | Domain logic                                |

**Guards** are for _authorization_ ("is this caller allowed?") — not input validation.
**Interceptors** are for cross-cutting response transformation (logging, serialisation) — not business logic.
**Pipes** are for per-parameter transformation/validation when a global `ValidationPipe` is insufficient — rarely needed.

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
