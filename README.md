#Deployement Link:
https://predictmycollegedse.netlify.app/

# Predict My College

Predicts which colleges and branches a student is likely to get, based on historical Maharashtra Direct Second Year (DSE) Engineering CAP Round cutoff data. It uses a static architecture with no database required—only static JSON files and a client-side frontend.

## Overview

This repository is built and validated against real Maharashtra State CET Cell data (`23-24.pdf`, `24-25.pdf`, and `2025-26.pdf` for Direct Second Year Engineering, CAP Round I). The built-in extraction pipeline processes these documents to generate clean cutoff records across hundreds of colleges.

## Workflow & Architecture

1. **PDF Parsing (`parse_cutoffs.py`)**: Uses coordinate-based extraction via `pdfplumber` to handle variable category columns and multi-stage rows.
2. **Validation (`validate.py`)**: Checks for malformed structures, missing values, or out-of-range percentiles.
3. **Dataset Building (`build_dataset.py`)**: Merges multiple years, deduplicates, and generates lookup metadata.
4. **Client-Side Prediction (`frontend/`)**: Runs entirely in the browser using static JSON chunks, loading metadata first and querying dynamically on demand.

## Tech Stack

* **Data Pipeline**: Python, `pdfplumber`
* **Storage**: Static JSON files generated at build time
* **Frontend**: Plain HTML, CSS, and modern JavaScript (ES modules) with zero external frameworks required
