Mijn timesheet-instellingen (de regels van mijn timesheet-plugin, zodat er maar één set regels is) gaan voor waar ze afwijken van het bovenstaande:
- Koppel werk aan een service met deze lijst (id | label | billable | trefwoorden), niet met een eigen keuze. Een niet-billable service boek je met `billable=false` bij `relay productive.add_time`. Boek per service één entry per dag, `relay productive.add_time` weigert een tweede.
{{services}}
- Boek op {{step}} minuten nauwkeurig, een werkdag is {{hours}} uur.{{placeholder}}
- Schrijf de notes in {{language}}. Een note heeft geen markering of voorvoegsel, geen emoji en geen streepjes (– of —), enkel een dubbele punt, komma en punt.{{git}}