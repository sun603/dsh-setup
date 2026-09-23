# dsh-chrome-devtools-mcp

Expose Google Chrome DevTools MCP as DSH agent tools. Tools are published under names such as `mcp__chrome-devtools__take_snapshot`.

The plugin starts `npx -y chrome-devtools-mcp@1.9.0` (override with `DSH_CHROME_DEVTOOLS_MCP_VERSION`) over stdio. By default it launches Chrome using the existing Google Chrome user-data directory and `Profile 2` (override with `DSH_CHROME_DEVTOOLS_PROFILE_DIRECTORY` if your profile differs). Optional environment variables: `DSH_CHROME_DEVTOOLS_MCP_VERSION`, `DSH_CHROME_DEVTOOLS_BROWSER_URL` (for example `http://127.0.0.1:9222`), `DSH_CHROME_DEVTOOLS_USER_DATA_DIR`, `DSH_CHROME_DEVTOOLS_PROFILE_DIRECTORY`, `DSH_CHROME_DEVTOOLS_MCP_COMMAND` (absolute npx path), and `DSH_CHROME_DEVTOOLS_MCP_CWD`.

The server can inspect and modify browser contents; do not connect it to sensitive browsing sessions. Restart dsh after installing.
