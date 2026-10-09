# Functional analysis: online booking for repair slots

*Fictional example (a bike repair shop), shown at the level of detail to aim for. Shortened to the key parts.*

| | |
|---|---|
| Requester | Shop owner |
| Desired delivery | 2026-03-01 |
| Reason for that date | Spring season starts, phone lines are full from March |
| Status | Ready to send |

## 1. Why

Customers book repairs by phone. The owner writes them in a paper diary and double bookings happen.

**How often:** about 40 bookings per week (counted over March last year), about 4 double bookings per month (estimate).

**If nothing happens:** double bookings stay, each one costs a customer visit that has to be rescheduled.

**Real example:** on 2025-04-12 two customers arrived for the 10:00 slot, one was sent away.

## 2. How it works today

1. Customer calls the shop. The owner checks the paper diary.
2. The owner writes name, phone number and repair type in a free slot.
3. The day before, the owner calls the customer to confirm.

**Outside the system:** the paper diary is the only record.

## 3. How it must work tomorrow

| Step | Today | Tomorrow | Change |
|---|---|---|---|
| 1 | Customer calls | Customer picks a free slot on the website | changed |
| 2 | Owner writes in diary | System stores the booking | changed |
| 3 | Owner calls to confirm | System mails a reminder 24 hours before | changed |

## 4. Rules

| Situation | What the system does |
|---|---|
| A slot has a booking | The slot is no longer offered |
| Repair type is "full service" | The booking takes 2 slots in a row |
| Booking is less than 2 hours away | The website does not offer the slot |
| Customer cancels more than 24 hours ahead | Slot is free again, no fee |

## 5. Cases

| ID | Situation | What the system must do | How I check this myself |
|---|---|---|---|
| BOOK-01 | Normal booking | Booking saved, confirmation mail sent within 1 minute | Book a test slot, see the mail and the diary entry |
| BOOK-02 | Who may do this | Any visitor books, only the owner and staff see all bookings | Open the admin page without logging in, it refuses |
| BOOK-03 | Existing paper bookings | The owner enters them once before launch, the system blocks those slots | Enter one, check it is not offered online |
| BOOK-04 | Phone number empty | Booking refused with the message "Phone number is required" | Leave the field empty and submit |
| BOOK-05 | Two customers pick the last slot at once | First one wins, second sees "Slot just taken" and the updated list | Two browsers, same slot |
| BOOK-06 | Customer cancels | Slot is free again within 1 minute | Cancel via the link in the mail |
| BOOK-07 | Mail service is down | Booking is kept, the owner sees a "mail failed" flag in the admin list | Stop the mail service in the test setup |
| BOOK-08 | Full service needs 2 slots, only 1 is free | Slot is not offered for that repair type | Book the first of two adjacent slots, check |
| BOOK-09 | What the customer sees | A confirmation mail with date, time, address and a cancel link | Read the test mail |
| BOOK-10 | Traceability | Each booking keeps its creation time and cancellation time | Admin list shows both columns |

## 6. Acceptance criteria

1. A slot that is booked is not offered to a second visitor, also with two simultaneous attempts.
2. A confirmation mail arrives within 1 minute of booking.
3. A reminder mail arrives 24 hours before the slot, plus or minus 15 minutes.
4. A full service booking occupies exactly 2 consecutive slots.

## 7. What must not break

| Existing function | Keeps working as | How I check that |
|---|---|---|
| Opening hours page | Shows the same hours | Compare before and after |

## 8. Scope

**Must ship (2026-03-01):** booking, confirmation mail, reminder mail, cancel link, admin list.

**Can come later:** online payment, because deposits are not required today.

## 9. Open questions

| # | Question | To whom | Needed for |
|---|---|---|---|
| 1 | Do e-bikes need a longer slot than 2 hours? | Owner | Rules table |

## 10. Quality gate

All seven checks pass. Open question 1 is listed apart and blocks nothing in the first delivery.
