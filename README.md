# Terminal Quest

A free browser game that teaches the basic file commands of **Linux** and **PowerShell** in a simulated shell. 16 short levels, each with a goal, hints and a win check. Play in Linux style, PowerShell style, or both side by side.

**Play it:** https://megastretch23.github.io/terminal-quest/

What it is, exactly:

- A static page set: `index.html`, `style.css`, `shell.js`, `levels.js`, `game.js`. No backend, no build step, no dependencies.
- The page makes no network requests of its own and has no analytics. Your only saved data is level progress, in your browser's `localStorage` (key `terminal-quest-v1`).
- A **simulation**, not a real shell. It has a small virtual filesystem and a subset of each command with simplified output (for example `Get-ChildItem` prints names, not the Mode/LastWriteTime table). Nothing touches your real files.

## Quickstart

```bash
git clone https://github.com/MegaStretch23/terminal-quest.git
cd terminal-quest
python -m http.server 8000      # or: python3 -m http.server 8000
# open http://localhost:8000/
```

Tests (Node 18 or newer, no packages to install):

```bash
node --test tests/
```

## The 12 commands

| Does | Linux | PowerShell |
|---|---|---|
| Where am I | `pwd` | `Get-Location` (`pwd`) |
| List files | `ls`, `ls -a` | `Get-ChildItem`, `-Force` (`ls`, `dir`) |
| Change folder | `cd DIR` | `Set-Location DIR` (`cd`) |
| Print a file | `cat FILE` | `Get-Content FILE` (`cat`, `type`) |
| Search text | `grep [-i] [-n] PATTERN FILE` | `Select-String -Pattern P -Path FILE [-CaseSensitive]` (`sls`) |
| New folder | `mkdir [-p] DIR` | `mkdir DIR`, `New-Item -ItemType Directory -Path DIR` |
| New empty file | `touch FILE` | `New-Item -ItemType File -Path FILE` |
| Copy | `cp [-r] SRC DEST` | `Copy-Item SRC DEST [-Recurse]` (`cp`, `copy`) |
| Move or rename | `mv SRC DEST` | `Move-Item SRC DEST` (`mv`, `move`) |
| Delete | `rm [-r] [-f] PATH` | `Remove-Item PATH [-Recurse]` (`rm`, `del`) |
| Print text | `echo TEXT` | `Write-Output TEXT` (`echo`) |
| First lines | `head -n N FILE` | `Get-Content FILE -TotalCount N`, `... | Select-Object -First N` |

Also supported: pipes (`cat a.txt | grep x | head -n 2`), one redirect at the end of a line (`>` or `>>`), and `*` / `?` wildcards in file names. Game commands: `hint`, `help`, `clear`.

**Side by side:** type in either pane. The command runs once against the shared filesystem; the other pane shows the equivalent command in its own syntax and the matching output. The equivalent is a translation of the same operation, not a byte-for-byte copy (for instance, PowerShell `New-Item -ItemType File` refuses an existing file, while `touch` leaves it alone).

Each shell only knows its own words, like the real ones: `Get-ChildItem` in Linux mode is "command not found", and `ls -a` or `head` in PowerShell mode is an error. Linux names are case-sensitive, PowerShell names are not, and `Select-String` ignores case unless you pass `-CaseSensitive` (level 12 is built around that).

Not implemented: variables, loops, scripts, `sudo`, permissions, `find`, `sort`, `sed`, tab completion, `ls -l`, more than one redirect per line.

## Levels

1 Where am I? / 2 Look around / 3 Read a file / 4 Step into a folder / 5 Back out / 6 Hidden things / 7 Make a folder / 8 Make a file / 9 Say it into a file / 10 Make a copy / 11 Rename / 12 Find the errors / 13 Just the top / 14 Clean up / 15 Remove a folder / 16 Mini project.

A level is won by the **state it leaves behind** (a file with the right content, the right folder), not by one exact command, so any correct route works. Each level has two or three hints; the last one spells out the command.

## Sample output (a saved run)

`examples/sample-run.txt` is the transcript of the built-in solution of every level, played in both shells through the real `shell.js` and `levels.js` by `node tests/sample_run.js --write`. A test fails if this file and the code disagree. An excerpt:

```
Level 6: Hidden things  (start in /home/player)
Goal: Read the hidden file .secret.
player@quest:~$ ls -a
.
..
.secret
backup/
docs/
logs/
notes/
projects/
readme.txt
tmp/
player@quest:~$ cat .secret
the hidden word is: lantern
-> level complete

Level 12: Find the errors  (start in /home/player)
Goal: Create errors.txt with exactly the 3 ERROR lines of logs/app.log.
player@quest:~$ grep ERROR logs/app.log > errors.txt
-> level complete

Level 12: Find the errors  (start in /home/player)
Goal: Create errors.txt with exactly the 3 ERROR lines of logs/app.log.
PS /home/player> Get-Content logs/app.log | Select-String -CaseSensitive ERROR > errors.txt
-> level complete
```

## Layout

```
index.html  style.css  game.js        the page
shell.js                              virtual filesystem, parser, command runner (also loads in Node)
levels.js                             the 16 levels, their win checks, progress storage
tests/                                node --test: shell, levels, README/no-network checks, sample_run.js
examples/sample-run.txt               the saved run quoted above
```

## More from the author

Terminal Quest is free and stays free. The same account also publishes paid tools (prices read from the live listings on 2026-11-13; check each page for the current price):

- [SEC Form 4 Scraper: Insider Buying Cluster Scanner](https://apify.com/johnveds15/sec-form4-insider-clusters?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest) on Apify: pay per event, $0.0004 per Form 4 filing parsed and $0.02 per insider cluster detected. Its free open-source core is [sec-form4-clusters](https://github.com/MegaStretch23/sec-form4-clusters).
- [CVE Vulnerability Scraper: NIST NVD, No API Key](https://apify.com/johnveds15/openvuln-cve-scanner?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest) on Apify: pay per event, $0.002 per CVE result.
- [Doom-detector for headless Claude Code runs](https://vedovino.gumroad.com/l/mjxcmw?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest) on Gumroad: $15.
- [blame-ai: AI-assist ledger for your git history (Python, local, no dependencies)](https://vedovino.gumroad.com/l/smhyy?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest) on Gumroad: $19.
- [pdfguard: find hidden prompt-injection text in PDFs before your LLM reads them (Python, local)](https://vedovino.gumroad.com/l/gvvcsh?utm_source=github&utm_medium=readme&utm_campaign=terminal-quest) on Gumroad: $19.

None of these is needed to use Terminal Quest.

## License

MIT, see `LICENSE`.
