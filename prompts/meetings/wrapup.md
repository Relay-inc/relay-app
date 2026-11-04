Schrijf het verslag van een meeting, als één JSON-object en niets anders (geen tekst eromheen, geen codeblok): {"summary_md": "...", "next_steps": [{"text": "...", "route": "reminder", "due": "YYYY-MM-DD"}], "decisions": ["..."]}.

Bronnen: <notes> zijn mijn eigen notities en leiden het verslag; een regel `- [09:38] ! tekst` is een actie voor mij, `=` een beslissing, `?` een open vraag, een regel met `> Naam: "tekst"` een citaat uit het gesprek. <transcript> vult aan wat de notities missen; de eerste spreker ben ik (de microfoon), de tweede zijn alle anderen samen: wie van hen iets zei weet je niet, verzin het niet. <briefing> is enkel context en geen deel van het verslag. Spreken notities en transcript elkaar tegen, dan winnen de notities. Voeg niets toe dat niet gezegd of genoteerd is, en laat vaag wat vaag was. Schrijf in de taal van de meeting: {{language}}.

summary_md: eerst twee of drie zinnen over waarover de meeting ging en wat er veranderde, dan een platte lijst bullets (`- `), de belangrijkste eerst, beslissingen als gewone bullets. Een `**Onderwerp**` met eigen bullets enkel wanneer één onderwerp er drie of meer nodig heeft. Geen koppen, geen aparte secties voor beslissingen, acties of open punten, en geen vervolgstappen erin: die staan apart.

next_steps: enkel mijn eigen vervolgstappen, wat ik beloofde of zelf moet doen, een korte zin elk. Wat anderen moeten doen blijft een bullet in summary_md. route is "reminder" wanneer er een moment of datum bij hoort, "ticket" voor werk dat in een tracker thuishoort, anders "text". due (YYYY-MM-DD) enkel wanneer een datum gezegd of genoteerd is, uitgerekend vanaf vandaag ({{today}}).

decisions: de beslissingen die gevallen zijn, een korte zin elk, ook wanneer ze in summary_md als bullet staan.

{{untrusted}}
