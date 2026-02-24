# FX Trading Engine

A professional-grade, multi-user Forex trading platform that automates M15 strategy execution on MetaTrader 5. Built with a modular monolith architecture combining NestJS backend, React frontend, and MQL5 Expert Advisor for real-time market execution.

## Overview

This platform bridges algorithmic trading strategy with institutional-grade execution infrastructure. It enables multiple traders to connect their MT5 terminals, backtest strategies on historical data, and execute trades automatically or with manual oversight through a web dashboard.

**Key Capabilities:**
- Multi-user support with Google OAuth authentication
- Real-time M15 bar ingestion from MT5 terminals
- Asia Range calculation and zone-based setup detection (S1, SSA, Mutazione)
- Historical data backfill (6+ months) for backtesting
- Configurable trade execution (automated or alert-only mode)
- Real-time monitoring dashboard with customizable strategy parameters

---

## Architecture

The system follows a clear separation of concerns across three layers:

### 1. **MT5 Expert Advisor (Execution Layer)**
   - **Language:** MQL5
   - **Responsibilities:**
     - Market data capture (M15 bars, tick data)
     - HTTP client for backend communication
     - Trade execution engine (open, modify, close positions)
     - Safety layer (position limits, reconciliation)
     - State persistence across terminal restarts
   - **Location:** `ea/`

### 2. **NestJS Backend (Strategy Brain)**
   - **Language:** TypeScript (Node.js 22+)
   - **Architecture:** Modular Monolith with CQRS/DDD patterns
   - **Responsibilities:**
     - Multi-tenant user management (Google OAuth)
     - Bar storage and historical data management
     - Asia Range calculation (01:00-08:15 Rome time)
     - Zone Engine (Attuale/Periferica/A+P tracking)
     - Setup detection (S1, SSA, Mutazione signals)
     - Risk management and position sizing
     - Command outbox for MT5 execution
     - Audit trail and reconciliation
     - Backtest engine for strategy validation
   - **Location:** `apps/backend/`
   - **Database:** PostgreSQL (Prisma ORM)

### 3. **React Frontend (Dashboard)**
   - **Language:** TypeScript (React 18+)
   - **Stack:**
     - **State:** Zustand (global state management)
     - **Data Fetching:** TanStack Query
     - **Routing:** TanStack Router
     - **Forms:** React Hook Form + Zod validation
     - **UI:** Radix UI + Tailwind CSS
   - **Responsibilities:**
     - User authentication (Google OAuth)
     - MT5 terminal connection management
     - Strategy parameter configuration
     - Real-time signal monitoring
     - Trade execution mode selection (auto/alert-only)
     - Historical backtest visualization
     - Performance analytics and audit logs
   - **Location:** `apps/frontend/`

### Infrastructure
- **Reverse Proxy:** Nginx (routing, SSL termination)
- **Containerization:** Docker + Docker Compose
- **Database:** PostgreSQL 16+
- **Message Queue:** BullMQ (future enhancement for async processing)

---

## Technology Stack

### Backend
- **Runtime:** Node.js 22+
- **Framework:** NestJS 10+
- **Language:** TypeScript 5+
- **ORM:** Prisma 5+
- **Database:** PostgreSQL 16+
- **Validation:** class-validator, class-transformer
- **Testing:** Jest (unit + integration)
- **Code Quality:** ESLint, Prettier, Husky (pre-commit hooks)

### Frontend
- **Framework:** React 18+
- **State Management:** Zustand
- **Data Fetching:** TanStack Query
- **Routing:** TanStack Router
- **Forms:** React Hook Form + Zod
- **UI Components:** Radix UI
- **Styling:** Tailwind CSS
- **Build Tool:** Vite
- **Testing:** Vitest + React Testing Library

### Expert Advisor
- **Language:** MQL5
- **Platform:** MetaTrader 5 (Wine on macOS, native on Windows)
- **Communication:** HTTP/JSON with backend API

### DevOps
- **Package Manager:** pnpm 9+
- **Monorepo:** Turbo
- **Containerization:** Docker, Docker Compose
- **Reverse Proxy:** Nginx
- **Version Control:** Git (Conventional Commits)

---

## Project Structure

```
fx-trading-engine/
├── apps/
│   ├── backend/              # NestJS API server
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/           # Google OAuth, JWT
│   │   │   │   ├── users/          # Multi-tenant user management
│   │   │   │   ├── terminals/      # MT5 terminal connections
│   │   │   │   ├── ingestion/      # M15 bar ingestion
│   │   │   │   ├── strategy/       # Asia Range, S1 detection, Zone Engine
│   │   │   │   ├── risk/           # Position sizing, limits
│   │   │   │   ├── execution/      # Command outbox for MT5
│   │   │   │   └── audit/          # Trade logs, reconciliation
│   │   │   ├── database/
│   │   │   │   ├── schema.prisma   # Database schema
│   │   │   │   └── migrations/     # Prisma migrations
│   │   │   └── shared/             # DTOs, exceptions, utils
│   │   └── test/                   # E2E tests
│   │
│   └── frontend/             # React SPA
│       ├── src/
│       │   ├── features/
│       │   │   ├── auth/           # Login, OAuth flow
│       │   │   ├── terminals/      # MT5 connection management
│       │   │   ├── strategy/       # Signal monitoring, config
│       │   │   ├── trades/         # Execution history, analytics
│       │   │   └── settings/       # User preferences
│       │   ├── shared/
│       │   │   ├── components/     # Reusable UI components
│       │   │   ├── hooks/          # Custom React hooks
│       │   │   └── api/            # TanStack Query setup
│       │   └── routes/             # TanStack Router routes
│       └── public/
│
├── ea/                       # MT5 Expert Advisor (MQL5)
│   ├── Experts/
│   │   └── FXTradingEngine.mq5    # Main EA file
│   ├── Include/
│   │   ├── Bootstrap/             # EA initialization
│   │   ├── MarketData/            # Bar capture
│   │   ├── HttpClient/            # Backend API calls
│   │   ├── Execution/             # Trade execution
│   │   ├── Safety/                # Position limits
│   │   └── State/                 # Persistence layer
│   └── README.md
│
├── nginx/                    # Reverse proxy config
│   └── nginx.conf
│
├── docker-compose.yml        # Multi-service orchestration
├── turbo.json                # Monorepo task pipeline
├── package.json              # Workspace root
└── README.md                 # This file
```

---

## Current Implementation Status

### ✅ Completed (Milestones 0-4.5)

#### M0: Repository & Infrastructure
- Monorepo setup (Turbo + pnpm workspaces)
- Docker Compose (PostgreSQL, backend, frontend, nginx)
- Git hooks (commitlint, lint-staged, pre-commit tests)
- Prisma schema with multi-schema support (public, ingestion, strategy, execution)

#### M1: Backend Foundation
- NestJS modular structure (CQRS/DDD patterns)
- Database migrations pipeline
- Health check endpoints
- Environment configuration
- Logging infrastructure (Winston)

#### M2: M15 Bar Ingestion
- `POST /api/ingest/bar` endpoint for MT5 bar submission
- Bar validation (OHLCV, timestamp, symbol)
- Deduplication logic (symbol + timestamp unique constraint)
- Database schema: `BarM15` table with indexes
- EA HTTP client for bar transmission on `OnTick()`

#### M3: Asia Range Calculation
- Daily Asia Range detection (01:00-08:15 Rome time)
- High/Low tracking across session
- Date-based indexing (Rome timezone)
- Replay endpoint: `POST /api/admin/replay-asia-range`
- Database schema: `AsiaRange` table

#### M4: S1 Signal Detection (Read-Only)
- S1 SHORT/LONG pattern detection with 4 validation rules:
  - ✅ Acceptance (body beyond Asia by ≥ 0.6 pips)
  - ✅ Engulfing (body-to-close by ≥ 0.6 pips)
  - ✅ Liquidity (absolute distance >0.5 pips at highs/lows)
  - ✅ Opposite Imbalance (<1.0 pip, with dominance/annulment escape routes)
- Operative window check (08:15-16:30 Rome time)
- Signal persistence with reason codes (acceptance insufficient, liquidity present, etc.)
- Replay endpoint: `POST /api/admin/replay-s1-signals`
- Database schema: `Signal` table with unique constraint (symbol + timestamp)

#### M4.5: Historical Data Backfill
- Backend state tracking: `HistoricalBackfill` table (symbol, oldest/newest bar timestamps)
- EA chunked upload (500 bars/batch via `HistorySelect`)
- Backfill detection: auto-start on EA attach to new broker/symbol
- Admin endpoints:
  - `GET /api/ingest/backfill/:symbol/status`
  - `POST /api/ingest/backfill/:symbol/acknowledge`
- Successfully backfilled 8 months (June 2025 - Feb 2026): 17,540 bars, 713 valid S1 signals

---

### 🚧 In Progress / Next Milestones

#### M5: Zone Engine (Attuale/Periferica/A+P)
**Status:** Specification complete, implementation pending

The Zone Engine is the **primary gating filter** for tradeable setups. Current S1 detector finds 713 valid signals in 8 months, but traders only act on ~1 per week (~34 total). The missing 95% are filtered by zone rules.

**Components to implement:**
- Breakout detection (track last 2 breakout events)
- Zone state machine (Attuale/Periferica/A+P)
- "Valid candle" definition (3 candles in continuation, 1 in reversal)
- Concordant/Discordant zone tracking
- 75% mitigation gating rules
- "Zone formed today" exclusion filter
- Zone updates on new breakouts

**Database schema:** `Zone` table with state tracking

#### M6: SSA Signal Detection
- Wick-only imbalance detection (≥1.0 pip)
- Body must NOT accept beyond Asia (otherwise it's S1)
- Same validation rules: engulfing, liquidity, opposite imbalance
- Integration with Zone Engine gating

#### M7: Mutazione Signal Detection
- Requires prior S1/SSA on same day
- Engulfing check only (no opposite imbalance)
- Different Fibonacci placement (low of push-up candle)
- Integration with Zone Engine gating

#### M8: Risk Management & Execution Commands
- Position sizing (FTMO-compliant: max 5% daily loss, 10% total drawdown)
- RR calculation (1:4 concordant, 1:3 discordant zones)
- Fibonacci order placement (50% - 5 pips entry, SL 10 pips above 100%)
- Command outbox: `PendingCommand` table for MT5 execution
- Admin override: force close positions before red news

#### M9: EA Execution Engine
- Poll backend for pending commands
- Order placement (limit orders at Fibonacci levels)
- Order management (cancel at RR 1:2 if unfilled)
- Trade management (move SL to BE at RR 1:2)
- Manual close triggers (liquidity return, red news)
- Session cleanup (cancel orders at 16:30, close positions Friday 22:00)

#### M10: Multi-User Authentication & Frontend
- Google OAuth integration (backend + frontend)
- User registration and terminal linking
- Dashboard features:
  - **Terminal Management:** Connect/disconnect MT5 accounts
  - **Strategy Config:** Customize S1/SSA/Mutazione parameters per user
  - **Execution Mode:** Toggle automated trading vs alert-only
  - **Live Signals:** Real-time display of detected setups with validity status
  - **Trade History:** Audit log of executed trades with P&L
  - **Backtest Results:** Historical performance visualization
  - **Risk Metrics:** Drawdown, win rate, RR distribution
- User preferences: notifications (email/webhook), risk limits

---

## Database Schema

The platform uses a multi-schema PostgreSQL database:

### `public` Schema
- `User`: Multi-tenant user accounts (Google OAuth)
- `Terminal`: MT5 terminal connections (terminalId, userId, symbol, broker)
- `Session`: Authentication sessions (JWT refresh tokens)

### `ingestion` Schema
- `BarM15`: OHLCV bars (symbol, timestamp, open, high, low, close, volume)
- `HistoricalBackfill`: Backfill state (symbol, oldestBarTime, newestBarTime)

### `strategy` Schema
- `AsiaRange`: Daily Asia session high/low (dateRome, high, low)
- `Zone`: Zone state (Attuale/Periferica/A+P, breakout tracking)
- `Signal`: Detected setups (S1/SSA/Mutazione with validation metrics)

### `execution` Schema
- `PendingCommand`: Commands for MT5 (open/modify/close orders)
- `Trade`: Executed trade records (entry, SL, TP, P&L)
- `AuditLog`: Reconciliation and manual interventions

---

## Key Features

### For Traders
- **Multi-Terminal Support:** Connect multiple MT5 accounts (different brokers, symbols)
- **Execution Flexibility:**
  - Automated mode: Platform executes trades autonomously
  - Alert-only mode: Receive notifications, trade manually
- **Strategy Customization:**
  - Adjust acceptance/engulfing thresholds
  - Modify liquidity tolerance
  - Set custom RR targets
  - Enable/disable specific setups (S1/SSA/Mutazione)
- **Risk Controls:**
  - Per-user position limits
  - FTMO-compliant drawdown protection
  - Manual override for high-impact news
- **Real-Time Monitoring:**
  - Live signal feed with validity reason codes
  - Open position tracking
  - Daily/weekly P&L dashboard

### For Developers
- **Clean Architecture:**
  - Domain-driven design (repositories, services, aggregates)
  - CQRS pattern (commands/queries separation)
  - Event-driven (domain events for cross-module communication)
- **Type Safety:**
  - Full TypeScript across backend/frontend
  - Prisma for type-safe database access
  - Zod for runtime validation
- **Testing:**
  - Unit tests (Jest/Vitest)
  - Integration tests (in-memory PostgreSQL)
  - E2E tests (Playwright for frontend)
- **Code Quality:**
  - ESLint + Prettier
  - Pre-commit hooks (lint-staged, tests)
  - Conventional Commits
- **Scalability:**
  - Modular monolith (easy to extract microservices if needed)
  - BullMQ for async job processing (future)
  - Horizontal scaling via Docker replicas

---

## Getting Started

### Prerequisites
- Node.js 22+
- pnpm 9+
- Docker & Docker Compose
- MetaTrader 5 (Windows or Wine on macOS)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/fx-trading-engine.git
   cd fx-trading-engine
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   ```bash
   cp apps/backend/.env.example apps/backend/.env
   cp apps/frontend/.env.example apps/frontend/.env
   # Edit .env files with your configuration
   ```

4. **Start infrastructure:**
   ```bash
   docker compose up -d
   ```

5. **Run database migrations:**
   ```bash
   cd apps/backend
   pnpm exec prisma migrate deploy
   ```

6. **Start development servers:**
   ```bash
   # Backend (http://localhost:3000)
   pnpm --filter @fx-trading/backend dev

   # Frontend (http://localhost:5173)
   pnpm --filter @fx-trading/frontend dev
   ```

7. **Compile and attach EA:**
   - Open MetaEditor in MT5
   - Open `ea/Experts/FXTradingEngine.mq5`
   - Compile (F7)
   - Attach to EURUSD M15 chart
   - Configure backend URL in EA inputs

---

## Development Workflow

### Backend Development
```bash
# Run tests
pnpm --filter @fx-trading/backend test

# Generate Prisma client after schema changes
pnpm --filter @fx-trading/backend exec prisma generate

# Create new migration
DATABASE_URL="postgresql://..." pnpm --filter @fx-trading/backend exec prisma migrate dev --name your_migration_name

# Lint
pnpm --filter @fx-trading/backend lint
```

### Frontend Development
```bash
# Run dev server with HMR
pnpm --filter @fx-trading/frontend dev

# Build for production
pnpm --filter @fx-trading/frontend build

# Run tests
pnpm --filter @fx-trading/frontend test
```

### EA Development
1. Edit `.mq5` files in MetaEditor
2. Compile with F7
3. Check compilation log for errors
4. Reload EA on chart (remove + reattach)

### Monorepo Commands
```bash
# Run all dev servers in parallel
pnpm dev

# Build all packages
pnpm build

# Lint all packages
pnpm lint

# Format all files
pnpm format
```

---

## API Endpoints

### Ingestion
- `POST /api/ingest/bar` - Submit M15 bar from EA
- `GET /api/ingest/backfill/:symbol/status` - Check backfill status
- `POST /api/ingest/backfill/:symbol/acknowledge` - Mark backfill complete

### Strategy (Admin Replay)
- `POST /api/admin/replay-asia-range` - Recalculate Asia Ranges
- `POST /api/admin/replay-s1-signals` - Rerun S1 detection

### Auth (Future)
- `POST /api/auth/google` - Google OAuth login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Invalidate session

### Terminals (Future)
- `GET /api/terminals` - List user's connected MT5 terminals
- `POST /api/terminals` - Register new terminal
- `DELETE /api/terminals/:id` - Disconnect terminal

### Signals (Future)
- `GET /api/signals` - List recent signals (filtered by user's terminals)
- `GET /api/signals/:id` - Signal details with validation metrics

### Execution (Future)
- `GET /api/trades` - Trade history
- `POST /api/trades/:id/close` - Manual close position
- `GET /api/commands/pending` - Poll for pending commands (EA endpoint)
- `POST /api/commands/:id/acknowledge` - Confirm command execution

---

## Trading Strategy Summary

The platform implements a professional Forex M15 strategy based on Asia Range breakouts with zone-based filtering.

### Core Concepts
1. **Asia Range (01:00-08:15 Rome time):** Daily high/low boundary
2. **Operative Window (08:15-16:30):** Trading session
3. **Zone Engine:** Tracks Attuale (current) / Periferica (previous) / A+P (merged) zones
4. **Setups:**
   - **S1:** Body acceptance beyond Asia (≥0.6 pips) + engulfing
   - **SSA:** Wick-only imbalance (≥1.0 pip) + engulfing
   - **Mutazione:** Continuation after S1/SSA on same day
5. **Risk Management:**
   - RR 1:4 (concordant zones) / 1:3 (discordant zones)
   - FTMO limits: 5% daily loss, 10% total drawdown
   - Position sizing based on account balance + risk %

### Validation Rules (S1 Example - SHORT)
- ✅ Acceptance: Body high ≥0.6 pips below Asia Low
- ✅ Engulfing: Engulf close ≥0.6 pips below push body low
- ✅ Liquidity: |push.high - engulf.high| >0.5 pips (absolute distance)
- ✅ Opposite Imbalance: push.high - asiaHigh <1.0 pip (or dominance/annulment applies)

**Zone Gating (95% filter):** Even valid S1 signals are only tradeable if zone context permits (75% mitigation, concordant/discordant rules, no same-day zone creation).

---

## Deployment

### Production Build
```bash
# Build all packages
pnpm build

# Start with Docker Compose
docker compose -f docker-compose.prod.yml up -d
```

### Environment Variables
**Backend (`apps/backend/.env`):**
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT tokens
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth secret
- `NODE_ENV` - production | development

**Frontend (`apps/frontend/.env`):**
- `VITE_API_URL` - Backend API URL
- `VITE_GOOGLE_CLIENT_ID` - Google OAuth client ID

---

## Testing

### Backend Tests
```bash
# Unit tests
pnpm --filter @fx-trading/backend test

# Integration tests
pnpm --filter @fx-trading/backend test:integration

# E2E tests
pnpm --filter @fx-trading/backend test:e2e

# Coverage
pnpm --filter @fx-trading/backend test:cov
```

### Frontend Tests
```bash
# Unit + component tests
pnpm --filter @fx-trading/frontend test

# E2E tests (Playwright)
pnpm --filter @fx-trading/frontend test:e2e
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes using Conventional Commits (`git commit -m "feat: add amazing feature"`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Commit Message Format:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

---

## License

This project is proprietary and confidential. Unauthorized copying, distribution, or use is strictly prohibited.

---

## Contact

**Developer:** Gregorio Fracassi
**Email:** [your-email@example.com]
**Portfolio:** [your-portfolio-url]
**LinkedIn:** [your-linkedin-url]

---

## Acknowledgments

- Strategy design based on institutional Forex trading techniques
- MT5 integration inspired by professional EAs
- Architecture follows NestJS best practices and DDD principles
- Frontend stack aligns with modern React ecosystem standards
