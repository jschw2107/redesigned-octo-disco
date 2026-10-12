# GroupBuy: Yeshiva University

This is the GroupBuy site rebuilt as a Next.js app with its own backend. It's set up for **Yeshiva University**, with **Rubin Hall, Muss Hall and Morgenstern Hall** plus an **Off-campus apartment** option.

- **Group orders with card payment.** Students add essentials, pick their university and residence hall at checkout, and pay by card through **Stripe Checkout**. Apple Pay and Google Pay work where available. An order only counts toward the round once it's paid.
- **Emails through Resend.** Students get a receipt when they pay, a welcome email when they join the waitlist, and a confirmation when they reserve an item. They're also emailed when an order is cancelled or refunded, and you can send pickup-details emails to everyone in a round. You can optionally get an email for every new order.
- **Order rounds on your schedule.** In **Admin → Schedule** you set how often the order closes and gets placed (every 1, 2 or 4 weeks, or any number of days) and when the current round closes. The next round opens automatically.
- **Individual store.** Students reserve leftover units and pay online. Stock is held for 30 minutes while they pay. If they don't finish, it goes back on the shelf.
- **Admin dashboard** at `/admin`. It has the purchase list, orders with payment status, one-click cancel-and-refund, pickup emails, products and prices, universities and halls, store inventory, and the waitlist. Orders, purchase totals and the waitlist can be downloaded as CSV files.

Without Stripe or Resend keys, the site still works: orders become "pay at pickup", and emails are printed to the server log. That makes local testing easy.

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
