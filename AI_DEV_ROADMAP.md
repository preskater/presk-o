# AI Cost, Engineering Economics, and Micro-Business Roadmap

## Mission

Build a modular operating system for independent developers and small software companies. The product must connect technical delivery, AI-agent consumption, developer tooling, project revenue, cash flow, and personal or family budgets without mixing their legal or privacy scopes.

The product must answer three questions:

1. **Spend:** What did AI, CI/CD, cloud, software seats, contractors, and labor cost?
2. **Allocation:** Which workspace, client, project, repository, developer, agent, issue, pull request, or period caused the cost?
3. **Economics:** Did project revenue and accepted delivery justify those costs?

## Product modules

- `budget`: personal cash management, forecasts, goals, alerts, and exports.
- `family`: household membership, shared/private scopes, goals, and budget recommendations.
- `real-estate`: property cash flow, occupancy, loans, maintenance, and performance.
- `development`: repositories, issues, pull requests, pipelines, deployments, and engineering metrics.
- `ai-costs`: provider usage, subscriptions, budgets, allocation, and reconciliation.
- `agents`: agent registry, versions, runs, outcomes, review, and rework.
- `micro-business`: clients, projects, quotes, invoices, payments, expenses, and cash forecasts.
- `profitability`: project revenue, direct cost, margin, forecast at completion, and risk alerts.
- `automation`: scheduled sync, rules, alerts, recommendations, and approvals.

Modules are activated per workspace. Cross-module capabilities appear only when their dependencies are enabled. Disabling a module hides its UI and rejects its actions but preserves its data.

## Metric rules

Every value is classified as one of:

- **Observed:** supplied by a provider or repository.
- **Derived:** deterministically calculated from observed values.
- **Allocated:** distributed under a recorded policy.
- **Estimated:** based on an assumption, rate, or forecast.
- **Reconciled:** matched to an invoice, payment, or authoritative total.

Unknown values remain unknown. Every KPI exposes its formula, period, source set, currency treatment, freshness, and missing-data behavior.

### Core formulas

- `AI cost = reconciled metered usage + allocated AI subscriptions`
- `Direct delivery cost = labor + AI + CI/CD + cloud + project software + contractors`
- `Contribution margin = recognized revenue - direct delivery cost`
- `Contribution margin rate = contribution margin / recognized revenue`
- `Forecast at completion = actual cost + estimated remaining cost`
- `Budget variance = forecast at completion - approved budget`
- `Agent cost coverage = attributable project revenue / agent cost`
- `Cost per accepted agent task = agent cost / accepted tasks`
- `Rework ratio = rework cost / initial delivery cost`

“Agent cost coverage” is not causal ROI. The UI must not claim that an agent caused project revenue.

## Labels

### Areas

- `area:platform`
- `area:modules`
- `area:budget`
- `area:family`
- `area:real-estate`
- `area:development`
- `area:ai-costs`
- `area:agents`
- `area:micro-business`
- `area:profitability`
- `area:integrations`
- `area:automation`
- `area:analytics`
- `area:security`
- `area:ux`

### Types and priorities

- `type:epic`
- `type:feature`
- `type:chore`
- `type:test`
- `priority:p0`
- `priority:p1`
- `priority:p2`
- `blocked`

## Global definition of done

- Server-side authorization and workspace scoping are enforced.
- Disabled modules expose neither navigation nor usable actions.
- Inputs are validated on the server.
- Money uses exact decimals and preserves source currency.
- Missing data is never silently converted to zero.
- Imports are idempotent, paginated, retry-bounded, and auditable.
- Secrets never enter logs, responses, client bundles, or container layers.
- Unit tests cover business rules and failure cases.
- HTTP adapters are tested with mocked transport.
- Migrations work on fresh and upgraded databases.
- User and architecture documentation is updated.
- Lint, typecheck, tests, migration checks, and production build pass.

# Milestones

> **Numbering note (2026-10-14):** milestone IDs below (M7–M19) are the GitHub milestone numbers; they continue the dashboard-era milestones M1–M6 from `docs/DASHBOARD_ROADMAP.md`. The first draft of this roadmap numbered them M0–M12.

## M7 — Modular workspace foundation

**Goal:** Introduce workspaces, memberships, roles, and module activation without breaking the existing owner experience.

**Exit criteria:** Existing data is migrated to a default workspace; every route and action is workspace-scoped; modules can be safely enabled and disabled.

### M7-01 — Introduce workspace and membership domain

**Labels:** `area:platform`, `type:feature`, `priority:p0`

Add `Workspace`, `WorkspaceMember`, roles, active-workspace resolution, and migration of the existing owner.

### M7-02 — Add module catalog and workspace entitlements

**Labels:** `area:modules`, `type:feature`, `priority:p0`

Define stable module keys, activation state, configuration, prerequisites, and server-side entitlement checks.

### M7-03 — Make navigation and dashboard module-aware

**Labels:** `area:modules`, `area:ux`, `type:feature`, `priority:p0`

Hide disabled modules, add module settings, explain dependencies, and preserve disabled-module data.

### M7-04 — Scope existing records by workspace

**Labels:** `area:platform`, `type:chore`, `priority:p0`

Scope budget, property, integration, alert, sync, and snapshot data with deterministic backfills and isolation tests.

### M7-05 — Add role and permission foundations

**Labels:** `area:security`, `type:feature`, `priority:p0`

Implement owner, admin, member, and viewer presets with route, action, and export authorization tests.

### M7-06 — Make seed and deployment workspace-aware

**Labels:** `area:platform`, `type:chore`, `priority:p1`

Keep seed idempotent while creating the initial workspace, membership, and selected modules.

## M8 — Family workspaces

**Goal:** Support several authenticated people with shared and private financial scopes.

**Exit criteria:** A household can invite members, define permissions, and manage shared budgets without exposing private accounts.

### M8-01 — Add household invitations and membership lifecycle

**Labels:** `area:family`, `area:security`, `type:feature`, `priority:p0`

Add expiring invitations, acceptance, revocation, member removal, and ownership-transfer safeguards.

### M8-02 — Add shared, private, and read-only scopes

**Labels:** `area:family`, `area:budget`, `type:feature`, `priority:p0`

Apply visibility and editability scopes to accounts, budgets, transactions, goals, and exports.

### M8-03 — Build household budget overview

**Labels:** `area:family`, `area:analytics`, `type:feature`, `priority:p1`

Show shared income, expenses, envelopes, goals, and member contributions without leaking private values.

### M8-04 — Add household activity audit

**Labels:** `area:family`, `area:security`, `type:feature`, `priority:p1`

Record who changed shared financial records and expose a bounded activity feed.

### M8-05 — Recommend explainable budget adjustments

**Labels:** `area:family`, `area:automation`, `type:feature`, `priority:p1`

Use three-to-six-month averages, medians, trends, and exceedance frequency; require confirmation before changing a budget.

## M9 — Canonical cost ledger

**Goal:** Normalize AI, CI/CD, cloud, subscriptions, tools, contractors, and labor into an auditable cost model.

**Exit criteria:** Costs can be imported, reconciled, split across dimensions, and traced to their source.

### M9-01 — Add monetary source and actuality primitives

**Labels:** `area:ai-costs`, `area:platform`, `type:feature`, `priority:p0`

Create exact-money types, source references, immutable timestamps, and observed/derived/allocated/estimated/reconciled states.

### M9-02 — Implement CostEntry and CostAllocation

**Labels:** `area:ai-costs`, `type:feature`, `priority:p0`

Support project, client, repository, developer, agent, issue, pull request, environment, and custom-tag dimensions.

### M9-03 — Add cost centers and allocation policies

**Labels:** `area:profitability`, `type:feature`, `priority:p1`

Support manual, equal-seat, usage-weighted, revenue-weighted, and fixed-percentage policies with versioned rationale.

### M9-04 — Add exchange-rate snapshots

**Labels:** `area:ai-costs`, `type:feature`, `priority:p1`

Preserve original currency and historical normalization rates without silent rewrites.

### M9-05 — Build manual and CSV cost import

**Labels:** `area:ai-costs`, `area:integrations`, `type:feature`, `priority:p0`

Add reusable mappings, previews, duplicate detection, rejection reasons, and import summaries.

### M9-06 — Build unallocated-cost inbox

**Labels:** `area:ai-costs`, `area:ux`, `type:feature`, `priority:p1`

Allow review, suggestion, bulk allocation, finalization, and traceability.

## M10 — Projects, clients, and revenue

**Goal:** Add the minimum commercial model needed for project economics.

**Exit criteria:** Revenue, payments, rates, estimates, repositories, and delivery costs can meet at one project boundary.

### M10-01 — Add clients and projects

**Labels:** `area:micro-business`, `type:feature`, `priority:p0`

Support fixed-price, time-and-materials, retainer, internal, and non-billable projects.

### M10-02 — Add revenue entries, invoices, credit notes, and payments

**Labels:** `area:micro-business`, `type:feature`, `priority:p0`

Separate issued, recognized, paid, overdue, refunded, and written-off amounts with partial payments.

### M10-03 — Add rate cards and loaded labor costs

**Labels:** `area:micro-business`, `area:profitability`, `type:feature`, `priority:p1`

Version client billing rates and confidential internal labor costs by effective date.

### M10-04 — Add estimate and scope-change versions

**Labels:** `area:profitability`, `type:feature`, `priority:p1`

Store baseline estimates, revisions, approved change requests, assumptions, and comparison snapshots.

### M10-05 — Add recurring business expenses and obligations

**Labels:** `area:micro-business`, `type:feature`, `priority:p1`

Track software renewals, contractors, insurance, social-charge reserves, and configurable planning envelopes without claiming tax advice.

### M10-06 — Add business-to-personal transfer rules

**Labels:** `area:micro-business`, `area:budget`, `type:feature`, `priority:p1`

Expose only explicit compensation, contribution, reimbursement, or withdrawal flows to personal/family budgets.

## M11 — AI provider integrations

**Goal:** Import authoritative provider usage and cost data securely and idempotently.

**Exit criteria:** At least OpenAI, Anthropic, OpenRouter, and CSV sources reconcile to provider totals.

### M11-01 — Create AI provider adapter contract

**Labels:** `area:integrations`, `area:ai-costs`, `type:feature`, `priority:p0`

Standardize authentication tests, discovery, pagination, usage, costs, cursors, retries, and reconciliation.

### M11-02 — Implement OpenAI organization cost adapter

**Labels:** `area:integrations`, `area:ai-costs`, `type:feature`, `priority:p0`

Import available project, user, API-key, source, and line-item dimensions.

### M11-03 — Implement Anthropic usage and cost adapter

**Labels:** `area:integrations`, `area:ai-costs`, `type:feature`, `priority:p0`

Import usage, models, workspaces, service tiers, costs, and unsupported-category warnings.

### M11-04 — Implement OpenRouter analytics adapter

**Labels:** `area:integrations`, `area:ai-costs`, `type:feature`, `priority:p1`

Import spend, requests, token classes, cache data, models, providers, keys, apps, and users.

### M11-05 — Add secure provider-credential management

**Labels:** `area:security`, `area:integrations`, `type:feature`, `priority:p0`

Encrypt credentials, show scopes and validation state, and never display saved secrets again.

### M11-06 — Add invoice reconciliation

**Labels:** `area:ai-costs`, `area:analytics`, `type:feature`, `priority:p1`

Compare estimated usage, provider-reported cost, invoice totals, credits, discounts, taxes, and FX differences.

### M11-07 — Implement Cursor team usage adapter

**Labels:** `area:integrations`, `area:ai-costs`, `type:feature`, `priority:p2`

Import member, model, token, request, included-spend, and overage data where available.

### M11-08 — Implement GitHub Copilot usage adapter

**Labels:** `area:integrations`, `area:development`, `type:feature`, `priority:p2`

Import seats, adoption, usage, agent-app activity, and stable agent identifiers without equating activity to productivity.

## M12 — Developer AI cost panel

**Goal:** Deliver explainable AI FinOps for individual developers and teams.

**Exit criteria:** Users can inspect spend, budget, forecast, allocation, subscriptions, and anomalies from aggregate to source.

### M12-01 — Build AI cost overview

**Labels:** `area:ai-costs`, `area:ux`, `type:feature`, `priority:p0`

Show spend, budget, forecast, requests, token classes, cache rate, cycle progress, and freshness.

### M12-02 — Build multidimensional cost explorer

**Labels:** `area:ai-costs`, `area:analytics`, `type:feature`, `priority:p0`

Filter and drill by provider, model, developer, key, project, repository, client, agent, and period.

### M12-03 — Add AI budgets and spend alerts

**Labels:** `area:ai-costs`, `area:automation`, `type:feature`, `priority:p0`

Support workspace, provider, developer, project, client, model, and agent thresholds.

### M12-04 — Add billing-cycle forecast

**Labels:** `area:ai-costs`, `area:analytics`, `type:feature`, `priority:p1`

Forecast metered usage plus recurring seats while exposing assumptions and insufficient-data states.

### M12-05 — Add subscription and seat register

**Labels:** `area:ai-costs`, `type:feature`, `priority:p1`

Track plans, seats, renewals, allowances, overages, ownership, cancellation, and allocation policy.

### M12-06 — Detect cost anomalies and waste

**Labels:** `area:ai-costs`, `area:automation`, `type:feature`, `priority:p1`

Detect unusual burn, idle seats, duplicated tools, runaway keys, expensive fallbacks, and expiring credits.

## M13 — Agent registry and run economics

**Goal:** Track agent identity, versions, execution costs, outcomes, human review, and rework.

**Exit criteria:** Cost and quality can be compared for equivalent task classes without misleading developer rankings.

### M13-01 — Add Agent and AgentVersion

**Labels:** `area:agents`, `type:feature`, `priority:p0`

Store model policy, tools, owner, repository scopes, status, configuration fingerprint, and historical versions.

### M13-02 — Add AgentRun ingestion

**Labels:** `area:agents`, `area:ai-costs`, `type:feature`, `priority:p0`

Store timing, trace IDs, tokens, linked costs, retries, tool calls, result, initiator, and delivery links.

### M13-03 — Add task and outcome taxonomy

**Labels:** `area:agents`, `type:feature`, `priority:p1`

Classify implementation, test, review, documentation, debugging, analysis, accepted, partial, rejected, failed, canceled, and superseded outcomes.

### M13-04 — Capture review, rework, defect, and rollback links

**Labels:** `area:agents`, `area:development`, `type:feature`, `priority:p1`

Relate human intervention and downstream quality signals without claiming sole causality.

### M13-05 — Build agent performance dashboard

**Labels:** `area:agents`, `area:analytics`, `type:feature`, `priority:p1`

Show success, acceptance, median cost per success, duration, retries, review cycles, rework, and defects with sample-size warnings.

### M13-06 — Add agent budgets and model policies

**Labels:** `area:agents`, `area:automation`, `type:feature`, `priority:p1`

Define allowed models, spend ceilings, alerts, optional gateway enforcement, and audited overrides.

## M14 — Engineering economics

**Goal:** Connect GitHub/GitLab delivery, time, CI/CD, cloud, and quality data to project costs.

**Exit criteria:** Engineering activity and infrastructure costs can be allocated to commercial projects and audited.

### M14-01 — Add repository-to-project mapping

**Labels:** `area:development`, `area:profitability`, `type:feature`, `priority:p0`

Map repositories, labels, milestones, branches, and path prefixes; route ambiguous activity to review.

### M14-02 — Extend GitHub delivery ingestion

**Labels:** `area:development`, `area:integrations`, `type:feature`, `priority:p1`

Import PR files, commits, reviews, comments, merge timing, releases, deployments, and issue relationships.

### M14-03 — Extend GitLab delivery and time ingestion

**Labels:** `area:development`, `area:integrations`, `type:feature`, `priority:p1`

Import MR time, approvals, commits, pipelines, deployments, issues, and milestones without double-counting.

### M14-04 — Import GitHub Actions usage and cost

**Labels:** `area:development`, `area:ai-costs`, `area:integrations`, `type:feature`, `priority:p1`

Track billable usage, allowances, storage, failed runs, reruns, runner types, and allocation limits.

### M14-05 — Import GitLab compute usage

**Labels:** `area:development`, `area:ai-costs`, `area:integrations`, `type:feature`, `priority:p1`

Track compute minutes, runner factors, shared runners, and configurable self-hosted imputed cost.

### M14-06 — Add time-tracking adapters

**Labels:** `area:development`, `area:integrations`, `type:feature`, `priority:p2`

Support GitLab time plus later Toggl, Clockify, or Harvest adapters through one canonical time-entry model.

### M14-07 — Build engineering cost dashboard

**Labels:** `area:development`, `area:analytics`, `type:feature`, `priority:p1`

Show labor, AI, CI/CD, cloud, SaaS, failed-pipeline, rework, cost per accepted task, and cost per deployment.

## M15 — Project profitability

**Goal:** Combine recognized revenue with delivery cost when micro-business and development modules are enabled.

**Exit criteria:** A project has explainable actual margin, budget variance, forecast at completion, and actionable risk alerts.

### M15-01 — Implement profitability calculation service

**Labels:** `area:profitability`, `type:feature`, `priority:p0`

Version rules for revenue recognition, direct costs, allocated overhead, contribution margin, and project result.

### M15-02 — Add forecast at completion

**Labels:** `area:profitability`, `area:analytics`, `type:feature`, `priority:p1`

Combine actual cost, open-work estimate, subscriptions, recurring infrastructure, and recent burn with manual override rationale.

### M15-03 — Build project economics page

**Labels:** `area:profitability`, `area:ux`, `type:feature`, `priority:p0`

Show revenue, collected cash, costs, margin, forecast, estimate variance, and drill-downs.

### M15-04 — Add agent cost coverage metrics

**Labels:** `area:agents`, `area:profitability`, `type:feature`, `priority:p1`

Calculate revenue-to-agent-cost coverage, cost per accepted task, cost per merged change, and rework ratio with explicit formulas.

### M15-05 — Detect unbilled completed work

**Labels:** `area:micro-business`, `area:development`, `area:automation`, `type:feature`, `priority:p1`

Find delivered work not covered by an invoice or retainer and support link, dismiss, or draft actions.

### M15-06 — Add margin-risk alerts

**Labels:** `area:profitability`, `area:automation`, `type:feature`, `priority:p1`

Alert on budget overrun, target-margin erosion, growing rework, and increasing AI cost with falling acceptance.

### M15-07 — Add portfolio profitability view

**Labels:** `area:profitability`, `area:analytics`, `type:feature`, `priority:p2`

Compare clients, projects, billing models, repositories, and periods while protecting confidential labor costs.

## M16 — Commercial integrations and cash planning

**Goal:** Reduce revenue-entry work and forecast business cash.

**Exit criteria:** External billing data can be reconciled to projects and upcoming cash risks are visible.

### M16-01 — Create billing-provider adapter contract

**Labels:** `area:integrations`, `area:micro-business`, `type:feature`, `priority:p1`

Standardize customers, invoices, lines, payments, refunds, pagination, and source references.

### M16-02 — Implement Stripe read-only adapter

**Labels:** `area:integrations`, `area:micro-business`, `type:feature`, `priority:p1`

Import customers, invoices, line items, payments, refunds, currency, status, and project metadata.

### M16-03 — Add invoice-to-project matching

**Labels:** `area:micro-business`, `area:automation`, `type:feature`, `priority:p1`

Match by stable metadata first and provide confidence-ranked suggestions for ambiguous legacy data.

### M16-04 — Add 30/60/90-day cash forecast

**Labels:** `area:micro-business`, `area:analytics`, `type:feature`, `priority:p1`

Model signed work, expected payments, delays, recurring expenses, reserves, and best/base/worst scenarios.

### M16-05 — Add overdue and concentration alerts

**Labels:** `area:micro-business`, `area:automation`, `type:feature`, `priority:p1`

Detect overdue invoices, payment delays, client concentration, runway deterioration, and upcoming obligations.

## M17 — Recommendations and optimization

**Goal:** Turn reliable historical data into explainable proposals, never silent financial mutations.

**Exit criteria:** Recommendations include evidence, confidence, confirmation, audit, and outcome tracking.

### M17-01 — Add recommendation framework

**Labels:** `area:automation`, `area:analytics`, `type:feature`, `priority:p1`

Support evidence, formula, confidence, proposed action, accept, dismiss, snooze, undo, and outcome.

### M17-02 — Recommend budget and AI-spend adjustments

**Labels:** `area:budget`, `area:ai-costs`, `area:automation`, `type:feature`, `priority:p1`

Use historical ranges, recurring costs, seasonality when sufficient, and explicit explanations.

### M17-03 — Detect model-routing opportunities

**Labels:** `area:agents`, `area:automation`, `type:feature`, `priority:p2`

Compare equivalent task classes and recommend cheaper models only with adequate samples and comparable outcomes.

### M17-04 — Detect retry, rework, and pipeline waste

**Labels:** `area:agents`, `area:development`, `type:feature`, `priority:p1`

Quantify failed agent runs, abandoned work, repeated review, flaky tests, reruns, and superseded pipelines.

### M17-05 — Recommend commercial intervention

**Labels:** `area:profitability`, `area:micro-business`, `type:feature`, `priority:p2`

Suggest scope review, change request, rate review, billing action, or delivery intervention based on explicit thresholds.

## M18 — Governance, privacy, and audit

**Goal:** Make financial and developer telemetry safe for real household and business use.

**Exit criteria:** Sensitive actions are permissioned, audited, exportable, and deletable with transparent retention.

### M18-01 — Add fine-grained permissions

**Labels:** `area:security`, `type:feature`, `priority:p0`

Separate financial, developer, credential, internal-rate, personal-scope, and export permissions.

### M18-02 — Add append-only audit log

**Labels:** `area:security`, `type:feature`, `priority:p0`

Audit credentials, allocations, rates, modules, invoices, recommendations, exports, and overrides without secrets.

### M18-03 — Add developer telemetry privacy controls

**Labels:** `area:security`, `area:development`, `type:feature`, `priority:p0`

Default to metadata-only ingestion; require separate opt-in and retention for prompt or completion content.

### M18-04 — Build reconciliation and data-quality center

**Labels:** `area:analytics`, `area:security`, `type:feature`, `priority:p1`

Expose stale sources, missing dimensions, duplicate candidates, invoice variance, and incomplete periods.

### M18-05 — Add export and deletion workflows

**Labels:** `area:security`, `type:feature`, `priority:p1`

Export normalized records and delete connectors with credential revocation, impact preview, and audit.

### M18-06 — Add retention policies

**Labels:** `area:security`, `type:feature`, `priority:p1`

Configure retention separately for raw telemetry, prompts, costs, financial records, audit events, and aggregates.

## M19 — Beta and commercial readiness

**Goal:** Prepare a supportable release for developers, households, and micro-businesses.

**Exit criteria:** Onboarding, diagnostics, backup/restore, end-to-end tests, privacy documentation, and operational runbooks are complete.

### M19-01 — Add guided modular onboarding

**Labels:** `area:ux`, `type:feature`, `priority:p1`

Select workspace type and modules, connect first sources, map a project, and explain privacy choices.

### M19-02 — Add isolated demonstration dataset

**Labels:** `area:ux`, `type:chore`, `priority:p1`

Provide clearly labeled profitable, at-risk, incomplete, and unallocated scenarios without mixing demo and production records.

### M19-03 — Add connector diagnostics

**Labels:** `area:integrations`, `type:feature`, `priority:p1`

Show permissions, quotas, rate limits, cursor, freshness, safe errors, retry, and reconnection.

### M19-04 — Expand backup and restore coverage

**Labels:** `area:platform`, `type:test`, `priority:p0`

Cover workspaces, memberships, costs, allocations, projects, revenue, agents, recommendations, and encrypted-secret metadata.

### M19-05 — Add end-to-end profitability scenario

**Labels:** `area:profitability`, `type:test`, `priority:p0`

Import AI usage, repository activity, labor, CI cost, invoice, and payment; allocate and assert margin, forecast, exports, and permissions.

### M19-06 — Publish operator, formula, and privacy documentation

**Labels:** `area:security`, `type:chore`, `priority:p1`

Document scopes, retention, backups, reconciliation, formulas, allocation policies, limitations, and non-accounting positioning.

### M19-07 — Add commercial entitlement hooks

**Labels:** `area:modules`, `type:feature`, `priority:p2`

Separate technical module activation from future plan entitlements without hard-coding current pricing.

## Delivery order

Critical path:

1. M7 — Modular workspace foundation
2. M9 — Canonical cost ledger
3. M10 — Projects, clients, and revenue
4. M11 — AI provider integrations
5. M12 — Developer AI cost panel
6. M14 — Engineering economics
7. M15 — Project profitability
8. M18 — Governance, privacy, and audit
9. M19 — Beta and commercial readiness

M8 can proceed after M7. M13 can proceed after M9 and in parallel with M11. M16 and M17 should start only after reconciliation is reliable.

## First sellable slice

The first commercial release should include:

- Modular workspaces and secure memberships.
- Personal and family budget scopes.
- Canonical AI/tool cost ledger.
- OpenAI, Anthropic, OpenRouter, and CSV imports.
- Clients, projects, invoices, and manual payments.
- Repository-to-project mapping.
- Developer AI cost dashboard.
- Project contribution margin and forecast.
- Basic GitHub/GitLab delivery attribution.
- Budget and margin alerts.
- Permissions, audit, exports, backups, restore tests, and documentation.

Cursor, Copilot, agent-run telemetry, Stripe, detailed CI economics, model-routing recommendations, and automatic provider controls are expansion features.
