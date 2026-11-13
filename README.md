# Terminal Quest

A free browser game that teaches command-line basics in 12 short levels. Pick **Linux (bash)** or **Windows PowerShell**, follow the task, and type real commands into a pretend terminal. It runs entirely in your browser on an in-memory file system: your real files are never touched, nothing is installed, and there are no dependencies.

**Play it:** https://megastretch23.github.io/terminal-quest/

## What you learn

| Level | Skill | Linux | PowerShell |
|---|---|---|---|
| 1 | Where am I? | `pwd` | `Get-Location` |
| 2 | List files | `ls` | `Get-ChildItem` |
| 3 | Move around | `cd quest` | `Set-Location quest` |
| 4 | Read a file | `cat readme.txt` | `Get-Content readme.txt` |
| 5 | Make a folder | `mkdir camp` | `New-Item -ItemType Directory -Name camp` |
| 6 | Write to a file | `echo lit > camp/torch.txt` | `echo lit > camp\torch.txt` |
| 7 | Copy | `cp map.txt camp` | `Copy-Item map.txt camp` |
| 8 | Move and rename | `mv treasure.tmp camp/treasure.txt` | `Move-Item treasure.tmp camp\treasure.txt` |
| 9 | Search inside a file | `grep KEY logs/server.log` | `Select-String KEY logs\server.log` |
| 10 | Search for files | `find . -name "*.log"` | `Get-ChildItem -Recurse -Filter *.log` |
| 11 | Delete a folder | `rm -r trash` | `Remove-Item -Recurse trash` |
| 12 | Pipes | `grep ERROR logs/app.log \| wc -l` | `Select-String ERROR logs\app.log \| Measure-Object` |

Each level checks the state of the pretend file system or the output of your command, not the exact text you typed, so any correct way works (for example `dir` or `ls` in PowerShell). Type `hint` for a nudge, `reset` to rebuild the world at the start of the level, `help` for the command list. Up/Down recalls history and Tab completes names. Progress is saved in your browser's local storage.

Typing a command from the other shell gives a pointer to its equivalent, for example `grep` in PowerShell mode answers with `Select-String`.

## Quickstart (run it locally)

```bash
git clone https://github.com/MegaStretch23/terminal-quest
cd terminal-quest
python3 -m http.server 8000      # then open http://localhost:8000
```

Or just open `index.html` in a browser. Add `?mode=ps` to the URL to start in PowerShell mode.

Run the tests (Node 18 or newer, no packages to install): they play every level through the engine and through the page code in both shells.

```bash
npm test        # or: node --test tests/
```

## How it is built

- `tq.js`: the engine. A tokenizer (quotes, `|`, `>`, `>>`), a command table that maps Linux names and PowerShell cmdlets/aliases onto one implementation each, an in-memory file tree, globbing (`*.txt`), and the level definitions with a reference solution per shell.
- `app.js` + `index.html`: the page. Plain DOM, no framework, no network calls.
- `tests/`: engine tests and a fake-DOM smoke test of the page.

It is a teaching sandbox, not a full shell: a small, honest subset of each command's options is implemented (`ls -l -a`, `cp -r`, `rm -r -f`, `grep -i -n -c -v -r`, `head`/`tail -n`, `wc -l`, `sort -r`, `Select-String -CaseSensitive`, `Get-Content -TotalCount`, and so on).

## Hosted and bulk

The game is free. Once the basics click, three separate paid tools from the same author:

- [SEC Form 4 insider clusters on Apify](https://apify.com/johnveds15/sec-form4-insider-clusters?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest): scrapes SEC Form 4 insider transactions to JSON and detects cluster buys by officers and directors, with amounts, prices and filing links. No API key needed. Pay per event; see the Actor page for the current price.
- [OpenVuln CVE Scraper on Apify](https://apify.com/johnveds15/openvuln-cve-scanner?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest): queries the NIST NVD for CVEs by product, keyword or severity and returns JSON. Pay per event; see the Actor page for the current price.
- [pdfguard on Gumroad](https://vedovino.gumroad.com/l/gvvcsh?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest): a local Python tool that finds hidden prompt-injection text in PDFs before your LLM reads them.


MIT licensed.
