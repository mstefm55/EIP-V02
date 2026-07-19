# V2 Workbench UI

Rendered operator-facing process workbench for V2.

## Runtime

1. Start API:
   - `cd C:\Projects\EIP\eip-core-V2\services\api`
   - `npm run dev`
2. Start UI:
   - `cd C:\Projects\EIP\eip-core-V2\apps\workbench-ui`
   - `npm install`
   - `npm run dev`
3. Open:
   - `http://localhost:5174/`
   - optional deep link: `http://localhost:5174/?surface=core_process_workbench`

The UI discovers tenant-scoped surfaces from `/api/eip/ui/surfaces`, then loads the selected surface from `/api/eip/ui/surfaces/:code` and consumes process workbench contracts from `/api/eip/process/*`.

Surface selection uses:
- in-memory metadata cache keyed by `tenant + realm + surface_code + version/etag`
- sessionStorage hint only for the last selected surface code per tenant/realm
- no sensitive/session/permission payload storage in localStorage

## Smoke Coverage

- Install browser dependency once:
  - `cd C:\Projects\EIP\eip-core-V2\apps\workbench-ui`
  - `npx playwright install chromium`
- Run authenticated runtime smoke:
  - `npm run test:smoke`
- Run authenticated smoke against deployed staging origin:
  - `set WORKBENCH_BASE_URL=https://localhost:8443`
  - `set E2E_API_ORIGIN=https://localhost:8443`
  - `set E2E_UI_ORIGIN=https://localhost:8443`
  - `set E2E_API_ENV_FILE=.env.v2.staging`
  - `set E2E_SHARED_PASSWORD=YOUR_SHARED_PASSWORD`
  - `npm run test:smoke:staging`

The smoke suite:
- seeds `v2.workbench.admin` (required read perms) and `v2.workbench.limited` (insufficient perms)
- validates authenticated rendering for core/ecom workbench surfaces through UI engine path
- validates permission fail-closed behavior in UI
- validates cookie/session/CSRF/CORS behavior in the real frontend -> API runtime path
