# Frontend & AI Engineer Assessment

## What you're building

This project is a partial implementation of an **order import system**. It ingests order data from various source formats (CSV, JSON) and normalizes it into a standardized order schema using an LLM to generate the field mappings.

The backend skeleton is in `api/server.js`. Your job is to bring it to life and build a frontend to interact with it.

## Your tasks

1. **Implement `POST /generate/config`** — parse the uploaded source file, use an LLM to generate a mapping configuration that maps source fields to the standardized order schema, and return it.

2. **Implement `POST /execute/config`** — take a mapping config and source file, apply the field mappings and transforms, and return the normalized orders.

3. **Build a frontend** — a UI that lets you run the full import flow: upload or paste source data, generate a config, execute it, and see the results.

See `api/README.md` for full endpoint specs, the target schema, and details on the sample data files in `sample-data/`.

## Setup

Install dependencies:
```bash
npm install
```

Set the OpenRouter API key (will be provided to you):
```bash
export OPENROUTER_API_KEY=your-key-here
```

Start the server:
```bash
npm start
```

The server runs on `http://localhost:3000`.

## Notes

- You have **1.5 hours** — we don't expect a fully polished or complete solution
- You're free to use AI coding assistants (Claude, Copilot, Cursor, etc.)
- You can add any npm packages you need
- You can modify any file, including `api/server.js`
- Internet access is available
- Ask questions at any point — there are no tricks

## Git

Please commit your work incrementally with clear, meaningful commit messages. This helps us follow your thought process.

## What we're evaluating

We're not looking for a perfect solution. We're primarily interested in:

- How you approach problems
- Your technical decision-making
- Your understanding of the code you write
- How you use AI tools effectively and responsibly

After the session we'll have a short follow-up discussion where we'll ask you to walk us through your implementation, explain the prompts you wrote, and discuss your technical decisions.
