# GENERAL Design Document

## Summary
Telegram bot for managing barber shop appointments. Clients can select services (haircut, beard, combo), view available weekly time slots, book appointments, view/cancel existing bookings, and receive a reminder notification on the day of their appointment. Designed for small to medium barber shops with fixed weekly schedules, targeting clients seeking convenient self-service appointment management.

## Core Entities
- **User**: Telegram user with properties: ID, name, registered status
- **Appointment**: Booking with properties: ID, user ID, service type, date/time, status (confirmed/cancelled)
- **Service**: Enumeration of available services (haircut, beard, combo) with durations
- **TimeSlot**: Available time window (15-30 minute increments) with properties: date/time, is_booked
- **Schedule**: Weekly calendar structure containing time slots grouped by day

Relationships:
- Users have many appointments
- Appointments belong to one service and one time slot
- Time slots belong to a specific schedule day
- Services define available options for appointments

## External Dependencies
- **Telegram Bot API**: 
  - Inline keyboards for service/slot selection
  - Scheduled messages for appointment reminders
  - Callback queries for interactive slot selection
- **Persistence**: 
  - Database storage for users, appointments, services, and time slots
  - Required fields: user ID, appointment timestamps, slot availability status
- **No third-party APIs** required for core functionality

## Features
- [ ] Service selection menu with inline buttons (haircut, beard, combo)
- [ ] Weekly schedule display showing available time slots (9:00-18:00, 30min increments)
- [ ] Slot booking confirmation with calendar update
- [ ] View active appointments with service details and time
- [ ] Appointment cancellation with slot reactivation
- [ ] Daily 10:00 AM reminder for same-day appointments
- [ ] Admin panel for setting weekly schedule (not user-facing)
- [ ] Conflict prevention for double bookings

## Non-Goals
- No payment integration or pricing calculation
- No multi-barber support or staff scheduling
- No real-time notifications for other users
- No integration with external calendar systems
- No client rating/review system