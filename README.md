# YouTube Ad Impressions

A Chrome extension that monitors the YouTube video player and captures metadata about the ads served to you. That data is stored in a database, and a backend server exposes it through an MCP server, allowing any compatible MCP client—such as ChatGPT—to query and interact with your personal ad history.

## Install

### Production Installation

The production version uses the hosted backend and database. Users do not need to install PostgreSQL, Supabase, Docker, or run the server themselves.

### Requirements

- Google Chrome
- An MCP-compatible client, such as ChatGPT
- A Google account for authentication

#### 1. Install the Chrome Extension

Install the extension from the Chrome Web Store.

> Chrome Web Store link coming soon.

Once installed, open the extension and sign in.

Authentication associates the ads captured by the extension with your account.

#### 2. Use YouTube Normally

Open YouTube and watch videos as usual.

When YouTube serves an advertisement, the extension monitors the video player and captures available metadata about the ad.

This may include:

- Advertiser name
- Advertiser domain
- Ad headline
- Call to action
- Creative title
- Ad duration
- Whether the ad was skipped
- When the ad was shown

The extension sends this information to the hosted application server, where it is stored in the application's database.

#### 3. Connect an MCP Client

The application exposes an MCP server that allows compatible AI clients to interact with your ad history.

Add the production MCP server to your MCP client:

```text
<MCP_SERVER_URL>
```

For example, in ChatGPT, add the application as an MCP integration using the production server URL.

#### 4. Authenticate

When the MCP client first attempts to access your data, you will be asked to authenticate.

A browser window will open where you can sign in and authorize access.

The MCP client can then securely access the ad history associated with your account.

#### 5. Ask Questions About Your Ads

Once connected, you can interact with your ad history using natural language.

For example:

```text
What ads have I been seeing lately?
```

```text
Which advertiser has shown me the most ads?
```

```text
What was that AI product I kept getting ads for?
```

```text
Which ads do I usually skip?
```

```text
What kinds of products are being advertised to me?
```

The MCP server queries your stored ad impressions and returns the relevant data to the client for analysis.

### How It Works

```text
YouTube
   ↓
Chrome Extension
   ↓
Hosted Application Server
   ↓
PostgreSQL Database
   ↓
MCP Server
   ↓
ChatGPT or another MCP client
```

The Chrome extension collects the data, the hosted application stores it, and MCP-compatible clients provide the interface for exploring it.

No local server or database setup is required.
