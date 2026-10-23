# AI Custom Quotation Generator — Backend Admin Pilot

## Security boundary
The pilot must remain under `/api/admin/...`, which is already mounted behind `requireAuth` and the admin router's `requireAdmin` guard. Do not create public upload or analysis endpoints. Template records must be scoped to `req.userId`.

## API design target
- `POST /api/admin/custom-quotation/analyze`: accept one PDF upload (12 MB maximum), validate MIME and PDF signature, extract per-page text/coordinates, and return candidate editable fields with confidence and page positions.
- `POST /api/admin/custom-quotation/templates`: persist a reviewed schema per admin user.
- `GET /api/admin/custom-quotation/templates`: list only the authenticated admin's templates.
- `POST /api/admin/custom-quotation/render`: validate user-entered values against the saved schema and return a generated PDF.

## Implementation notes
The backend currently has no PDF parsing, OCR, AI provider, or PDF generation dependency configured. Before implementing analysis/render endpoints, select and configure a server-side AI provider (if semantic detection is required), a PDF parser and a renderer/overlay library, plus OCR for scanned files. Keep provider keys in hosting environment variables. Never trust model-produced amounts or tax rates; calculate totals with explicit application rules and require review for ambiguous values.

## Non-regression
Do not change existing billing, GST, authentication, subscription, or Cashfree payment handlers as part of this pilot. Add tests for authorization, ownership isolation, invalid/oversized PDFs, multi-page PDFs, scanned documents, and output page count before merging.

## Current status
This is the implementation contract, not a claim that the endpoints above already exist. The existing template CRUD is admin-only; complete analysis and same-format PDF rendering remain to be implemented and verified.
