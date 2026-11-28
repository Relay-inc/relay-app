Los deze Aikido-bevindingen op in {{repos}}. Werk in de checkout van de repo ({{checkouts}}), op een nieuwe branch `{{branch}}` vanaf de standaardbranch. Fix precies deze bevindingen, niets anders:

{{findings}}

{{untrusted}} Een gelekt secret haal je uit de code en de config, en je zegt dat het geroteerd moet worden; roteren doe je niet zelf. Draai daarna de checks van de repo (lint, tests, build, zoals de repo ze beschrijft) tot ze groen zijn, en open per repo een PR die het PR-template van de repo volgt: elke sectie ingevuld, n/a met de reden waar iets niet van toepassing is. Negeer, onderdruk of verberg nooit een bevinding (geen ignore-regel, geen suppress-commentaar, geen uitgesloten pad) en verzwak geen enkele check of drempel om groen te krijgen. Lukt een fix niet zonder dat, stop dan en zeg waarom. Meld hier wat je veranderde, welke checks je draaide met hun resultaat, en de link naar elke PR.
