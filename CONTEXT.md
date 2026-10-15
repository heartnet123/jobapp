# Job Application Tracker

Personal career command center for tracking job applications, managing pipeline stages, and automating email follow-ups.

## Language

**Job Application**:
A single candidate record tracking a specific job opening from discovery through offer or rejection.
_Avoid_: Job, posting, lead, ticket

**Stage**:
The current milestone of a job application (Applied, Take-home, Interview, Offer, Rejected).
_Avoid_: Status, column, phase

**Data Export**:
A complete or tabular snapshot of tracked applications generated for backup or external analysis.
_Avoid_: Dump, backup file, download

**Data Import**:
An atomic bulk restore of application records from an external JSON file into local SQLite storage.
_Avoid_: Upload, sync, ingest

**Conflict Policy**:
The strategy (`skip` or `overwrite`) applied when an imported record shares an ID with an existing database entry.
_Avoid_: Merge strategy, de-duplication mode
