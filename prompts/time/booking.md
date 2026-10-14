Werk zo:

1. Haal met `relay productive.time_entries` (after en before {{date}}) op wat al geboekt is. Een entry heeft enkel een service-id: zoek per project de services op met `relay productive.services` om te weten bij welk project ze horen. Trek het geboekte af en boek nooit dubbel; blijft er voor een project minder dan 15 minuten over, sla het over.

2. Vul aan met de andere bronnen van {{date}}. Een bron die niet verbonden is sla je over, en je zegt op het einde welke. Tijd die al in een andere bron zit tel je niet twee keer (een meeting waarin ik ook in een gesprek schreef is één blok).
   - Agenda: `relay calendar.meetings date={{date}}`, exacte duur per meeting. Enkel meetings met andere genodigden; focus- en prepblokken haal je met de Google Calendar-connector als die er is.
   - Slack (claude.ai-connector): mijn eigen berichten die dag per kanaal, als gewicht voor coördinatie en welke klant aandacht kreeg.
   - Git: mijn eigen commits die dag (`git log --all --author=<mijn e-mail> --since/--until`) in de repo's onder ~/projects. Een repo koppel je aan een project op naam.
   - Andere Claude Code-sessies: transcripten in ~/.claude/projects/*/*.jsonl met berichten van mij die dag (velden type "user" en timestamp), behalve {{counted}}. Tel 10 minuten rond elk bericht, zoals hierboven. De mapnaam is het pad van de werkmap.
   - Google Drive, Jira (Atlassian), Notion en Figma via hun connectors: wat ik die dag bewerkte, als gewicht.
   Persoonlijke projecten en zijprojecten zijn geen klanttijd: die boek je niet. Verzin nooit een activiteit of een duur.

3. Koppel elk project aan zijn Productive-project: gebruik het project-id hierboven als dat er staat, anders zoek je het met `relay productive.projects` op naam. Kies met `relay productive.services` de passende service (budgetlijn).

4. Doe per project één voorstel met `relay productive.add_time` (service, date, minutes, een korte note uit de titels van de gesprekken, meetings, commits en Slack-onderwerpen; geen gedachtestreepjes). Ik keur elke boeking goed of corrigeer ze in de kaart.

5. Som op het einde op wat geboekt is per bron, wat je oversloeg, en hoeveel van een werkdag van 8 uur er niet gedekt is.
