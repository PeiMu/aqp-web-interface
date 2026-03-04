# AQP Middleware Demo — Web Interface

A web-based visualization tool for the AQP middleware query splitting pipeline.

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/bitaasudeh/aqp-web-interface.git
cd aqp-web-interface

# 2. Install dependencies
npm install

# 3. Start the backend server (Express, port 3001)
node server.js

# 4. In another terminal, start the frontend (Vite, port 5173)
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Prerequisites

- Node.js (v18+)
- The AQP middleware binary (update the path in `server.js` if needed)
- JOB benchmark query files (update the path in `server.js` if needed)
- A running database engine (PostgreSQL / DuckDB / Umbra / MariaDB)

## Stack

- **Frontend:** React 18 + Vite
- **Backend:** Express (Node.js)
