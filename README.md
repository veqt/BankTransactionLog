# Geldstrom

Geldstrom ist eine Desktop-Anwendung zur Auswertung von Banktransaktionen aus CSV-Dateien. Offene Buchungen werden kategorisiert, Regeln gespeichert und die Ergebnisse anschließend im Dashboard ausgewertet.

## Release

| Release | Datei | Kompatibilität | Download |
| --- | --- | --- | --- |
| `v1.0` | `Geldstrom_Portable_v1.0.zip` | Sparkasse - Excel (CSV-CAMT V8) | [Herunterladen](https://github.com/veqt/BankTransactionLog/releases/download/v1.0/Geldstrom_Portable_v1.0.zip) |

Weitere Releases: [GitHub Releases](https://github.com/veqt/BankTransactionLog/releases)

## Bedienung

1. Programm starten.
2. In die Ansicht **Upload** wechseln.
3. Auf **CSV-Datei auswählen** klicken und die Bankdatei laden.
4. Warten, bis vorhandene Regeln automatisch angewendet und offene Transaktionen erkannt wurden.
5. Für jede offene Transaktion eine Kategorie auswählen oder eine neue Kategorie definieren.
6. Für jede offene Transaktion einen Regelnamen festlegen. Standard ist **Kreditor/Debitor**.
7. Mit **Kategorie übernehmen** die aktuelle Entscheidung speichern und zur nächsten offenen Transaktion wechseln.
8. Den Vorgang wiederholen, bis alle offenen Transaktionen bearbeitet sind.
9. Nach Abschluss die erzeugte JSON-Datei im Upload-Bereich speichern bzw. übernehmen.
10. Im **Dashboard** Ausgaben, Einnahmen, Summen und Transaktionen auswerten.
11. Optional in **Regeln** gespeicherte Zuordnungen anpassen.
12. Optional in **Dateien** vorhandene JSON-Dateien bearbeiten, umbenennen oder löschen.