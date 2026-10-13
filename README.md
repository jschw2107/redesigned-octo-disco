# GroupBuy: a reverse marketplace for students

**Students set the price. Sellers compete. Everyone pays the same.**

GroupBuy aggregates purchase intent *before* the purchase happens, then uses it to negotiate:

1. **Campaigns** ("GroupBuy #001"): a normal price, a starting target, "I'll buy at" price levels ($199 / $189 / $179…) and indicative tiers ("150 buyers → $189").
2. **Students join at their maximum price.** Nothing is charged. With email on, they confirm via a link, so the counts are verified buyers. Each buyer gets a private link to change or withdraw and a share link that tracks referrals.
3. **Admin → GroupBuys → Demand curve** shows how many buyers and units you can deliver at each price. Take that to sellers.
4. **Lock in a seller's price:** everyone whose maximum is at or above it wins (earliest first if the seller caps units) and **their saved card is charged that one clearing price automatically**. Students save a card when they join (Stripe Checkout in setup mode, with explicit consent to one automatic charge, never above their maximum). If a charge fails, that buyer is emailed a payment link instead. Everyone else is emailed that they weren't charged.
5. **Requests:** students propose GroupBuys ("Who wants a 65-inch TV under $400?") and others back them. Turn popular ones into live campaigns, and supporters are emailed when it goes live.
6. **Revenue:** GroupBuy keeps a share of each buyer's savings (normal price − deal price), 20% by default (Admin → Settings), charged with the order as a separate line. Each buyer's rate is locked when they join, and their consent shows the most they could pay including the fee.
7. **Admin → Demand** shows the headline metric: *"In seven days, we aggregated $X of committed purchasing demand from Y students."*

Optional: **Admin → Settings** can restrict joining to school emails (e.g. `mail.yu.edu`).

## Run it locally

```bash
npm install
cp .env.example .env.local    # set ADMIN_PASSWORD at minimum
npm run dev
```

Open http://localhost:3000 for the site and http://localhost:3000/admin for the dashboard.

## Set up payments (Stripe)

1. Create a Stripe account at https://dashboard.stripe.com. Stay in **Test mode** while you try it out.
2. Go to **Developers → API keys** and copy the **Secret key** into `STRIPE_SECRET_KEY`.
3. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-SITE/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
4. Place a test order with card `4242 4242 4242 4242`, any future expiry date and any CVC.
5. When you're ready to go live, switch to live keys and add a live webhook endpoint.

**Testing webhooks locally:** run `stripe listen --forward-to localhost:3000/api/stripe/webhook` with the Stripe CLI, and use the `whsec_…` it prints. Even without the webhook, a payment is confirmed when the student lands back on the order page. The webhook covers students who close the tab.

**Refunds:** in **Admin → Orders**, set a paid order's status to **Cancelled + refunded**. That refunds the card in full and emails the student. Store reservations work the same way.

**Fees:** Stripe charges per transaction (in the US, typically 2.9% + 30¢ per card payment). Prices are charged exactly as listed. Sales tax isn't added; Stripe Tax can do that if you need it.

## Set up email (Resend)

1. Create an account at https://resend.com and **add and verify your domain**. This takes a few DNS records.
2. Create an API key and put it in `RESEND_API_KEY`.
3. Set `EMAIL_FROM`, for example `GroupBuy <orders@yourdomain.com>`, using the domain you verified.
4. Set `EMAIL_REPLY_TO` to the inbox where student replies should go, and optionally `ADMIN_EMAIL` to get an email for every new order.
5. Use **Admin → This round → Send test email** to check that it works.

Before your domain is verified, Resend only lets you send to your own address from `onboarding@resend.dev`.

## Deploy (Vercel + Turso)

1. Create a free [Turso](https://turso.tech) database and copy its URL (`libsql://…`) and token.
2. Push this folder to GitHub and import it in Vercel.
3. Add every variable from `.env.example` in Vercel → Settings → Environment Variables. `SITE_URL` must be your real address.
4. Deploy, then add the Stripe webhook using your live URL.

Tables, the Yeshiva University campus and the products are created on the first request.

## Changing campuses

**Admin → Universities & halls** controls the checkout and waitlist options. With one university, the site speaks to it directly ("Now launching at Yeshiva University"). If you add more schools, a campus picker appears automatically. The pickup location currently says *"Wilf Campus (exact spot emailed before each pickup)"*. Change it there once you have a spot.

## Project layout

```
app/                    pages (/, /checkout, /order/[id], /reservation/[code], /admin) and API routes
app/api/stripe/webhook  Stripe → server payment updates
components/             UI (product grid, cart, checkout, location picker, admin screens)
lib/db.ts               database connection, schema, migrations, starter data
lib/fulfill.ts          payment confirmation, expiry, refunds, cancellation
lib/stripe.ts           Stripe client
lib/email.ts            Resend sender + email templates
lib/data.ts             queries + order-round logic
lib/tz.ts               time-zone math for the schedule
```
