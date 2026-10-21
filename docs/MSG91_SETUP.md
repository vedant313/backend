# MSG91 Phone OTP setup for Nexsa Bills

## Backend environment variables
Configure these on the backend host (Render), never in frontend variables:
- MSG91_AUTH_KEY: Authkey from the MSG91 dashboard.
- MSG91_OTP_TEMPLATE_ID: ID of the approved OTP template.

Never commit real credentials. Rotate any authkey that was exposed in a repository.

## MSG91 dashboard
1. Sign in to MSG91 and open the OTP product.
2. Create an OTP template using the provider OTP placeholder (usually `##OTP##`) and copy its template ID.
3. For India delivery, complete applicable DLT entity, sender/header and template mapping requirements.
4. Add the two environment variables to the backend service and redeploy.
5. Test send, invalid OTP, expiry, cooldown, and successful login with your own phone. Check MSG91 OTP logs if delivery fails.

Official docs:
- Send OTP: https://docs.msg91.com/otp/sendotp
- OTP API overview: https://docs.msg91.com/otp
- India DLT/template mapping: https://msg91.com/help/dlt-registration-in-india/map-sms-content-template-on-msg91-api-panel

## Endpoints
- POST /api/auth/phone-otp/send — body: { "phone": "9876543210" }
- POST /api/auth/phone-otp/verify — body: { "phone": "9876543210", "otp": "123456", "name": "New User", "email": "user@example.com" }

Name/email are required only to create a new account. Existing phone-linked accounts can sign in with OTP. If the email already belongs to an account, the integration refuses to silently link it or create a duplicate. Existing users should continue using email/password until a separate authenticated phone-link flow is added.

## Data preservation
- No existing users, invoices, business profiles, payments, expenses or subscriptions are deleted or rewritten.
- The sparse unique phone index permits legacy user records without a phone field.
- Existing email/password login remains enabled.
- Existing users are not automatically linked to a phone.
- Initial rate limits are process-local. Use a shared Redis/MongoDB limiter before running multiple backend instances or calling this production-hardened.

