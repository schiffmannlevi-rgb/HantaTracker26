# HantaTracker26

HantaTracker26 is a static outbreak-intelligence globe for source-linked hantavirus reporting. The frontend runs from static files, while the official data snapshot is stored in `data/outbreak-feed.js`.

## Local Commands

```bash
npm run serve
npm run check
npm run update-feed
```

## Going Live

The simplest production setup is:

1. Push this folder to a GitHub repository named `HantaTracker26`.
2. Import the repository into Vercel.
3. Use Vercel's default static-site settings:
   - Framework preset: Other
   - Build command: None
   - Output directory: `.`
4. Keep the GitHub Actions workflow enabled.

The workflow in `.github/workflows/update-outbreak-feed.yml` runs daily at 15:00 UTC, pulls the newest official WHO source data, commits `data/outbreak-feed.js` if it changes, and lets Vercel redeploy automatically from GitHub.

## Data Notes

- Visible counts should stay tied to official source links.
- The app separates official source date, updater pull time, and browser check time.
- No synthetic case counts should be displayed.
