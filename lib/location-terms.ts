// Getrennt von lib/location.ts, weil diese Datei ins Browser-Bundle gezogen wird
// (ui/app.tsx importiert sie für die Warnung auf der Einstellungsseite) und
// lib/location.ts readFileSync benutzt. Dieselbe Trennung wie bei lib/calendar.ts.

// Exakt verglichene Länderangaben: ein Job, dessen Ort NUR "Österreich" ist, gilt als
// unbekannt und wird behalten — das Detail-Urteil trifft dann der Mensch oder das LLM.
//
// Warum das eine scharfe Kante ist: dieselben Wörter als Region eingetragen greifen über
// den Substring-Pfad in isInRange(), und dann passiert jeder Job mit "…, Österreich" den
// Filter — er ist damit praktisch aus. "at" wäre als Substring vollends fatal (steckt in
// Klagenfurt, Amstetten, Bruck an der Mur). Deshalb bleibt die Liste Code und wird nicht
// zur Einstellung; die Seite liest sie nur, um davor zu warnen.
export const COUNTRY_ONLY = ['österreich', 'oesterreich', 'austria', 'at'];
