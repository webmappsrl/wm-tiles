#!/usr/bin/env python3
"""
Quali file di TINITALY toccano un riquadro in gradi.

Legge da stdin righe `nome|Upper Left ...|Lower Right ...|` (l'uscita di
gdalinfo, che accanto alle coordinate UTM stampa gli angoli in gradi, minuti
e secondi) e scrive i nomi dei file che intersecano il riquadro. Se un file
non ha gli angoli in gradi si ferma: meglio un errore che una cella senza
quote.

Uso: ... | python3 pipeline/tinitaly-celle.py W,S,E,N
"""
import re
import sys

DMS = re.compile(r"(\d+)d\s*(\d+)'\s*([\d.]+)\"([EWNS])")
# I file stanno in UTM: i loro bordi non seguono meridiani e paralleli, e
# gli angoli opposti non bastano a contenerli. Un margine copre la torsione.
MARGINE = 0.05


def gradi(testo):
    g, m, s, emi = DMS.search(testo).groups()
    v = int(g) + int(m) / 60 + float(s) / 3600
    return -v if emi in "WS" else v


def main():
    w, s, e, n = map(float, sys.argv[1].split(","))
    for riga in sys.stdin:
        riga = riga.strip()
        if not riga:
            continue
        nome, *angoli = riga.split("|")
        coppie = []
        for a in angoli:
            pezzi = re.findall(r"\(([^()]*)\)", a)
            if len(pezzi) == 2 and DMS.search(pezzi[1]):
                lon, lat = pezzi[1].split(",")
                coppie.append((gradi(lon), gradi(lat)))
        if len(coppie) < 2:
            sys.exit(f"{nome}: gdalinfo non riporta gli angoli in gradi")
        (x1, y1), (x2, y2) = coppie[:2]
        if (min(x1, x2) - MARGINE < e and max(x1, x2) + MARGINE > w
                and min(y1, y2) - MARGINE < n and max(y1, y2) + MARGINE > s):
            print(nome)


if __name__ == "__main__":
    main()
