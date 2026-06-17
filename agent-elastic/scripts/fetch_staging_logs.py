"""Extrae los últimos logs del index pattern log-*staging* desde Elasticsearch."""
import argparse
import json

from elasticsearch import Elasticsearch

ES_URL = "http://172.23.7.44:9200"
INDEX_PATTERN = "log-*staging*"


def main():
    parser = argparse.ArgumentParser(description="Últimos logs de Elasticsearch")
    parser.add_argument("-n", "--size", type=int, default=20, help="Cantidad de logs")
    parser.add_argument("-i", "--index", default=INDEX_PATTERN, help="Index pattern")
    parser.add_argument("--host", help="Filtro hostname (wildcard, ej: consumer*)")
    parser.add_argument("--level", help="Filtro level (ej: error)")
    parser.add_argument("--raw", action="store_true", help="Imprime el _source completo en JSON")
    args = parser.parse_args()

    es = Elasticsearch(ES_URL, request_timeout=60)
    info = es.info()
    print(f"Conectado a cluster '{info['cluster_name']}' (ES {info['version']['number']})\n")

    filters = []
    if args.host:
        filters.append({"wildcard": {"hostname.keyword": {"value": args.host}}})
    if args.level:
        # level puede venir en minúsculas o capitalizado; matcheamos ambos
        variants = {args.level.lower(), args.level.capitalize(), args.level.upper()}
        filters.append({"bool": {"should": [{"term": {"level": v}} for v in variants],
                                 "minimum_should_match": 1}})
    query = {"bool": {"filter": filters}} if filters else {"match_all": {}}

    resp = es.search(
        index=args.index,
        size=args.size,
        sort=[{"@timestamp": {"order": "desc"}}],
        query=query,
        ignore_unavailable=True,
    )

    hits = resp["hits"]["hits"]
    print(f"Mostrando {len(hits)} logs más recientes:\n" + "=" * 80)

    for h in hits:
        src = h["_source"]
        if args.raw:
            print(json.dumps(src, ensure_ascii=False, indent=2))
            print("-" * 80)
            continue
        ts = src.get("@timestamp", "?")
        level = src.get("level") or src.get("log", {}).get("level", "")
        msg = src.get("message") or src.get("msg") or ""
        if isinstance(msg, (dict, list)):
            msg = json.dumps(msg, ensure_ascii=False)
        msg = str(msg).replace("\n", " ")[:300]
        host = src.get("hostname", "")
        print(f"[{ts}] {level:<6} {host}  ({h['_index']})")
        print(f"   {msg}")


if __name__ == "__main__":
    main()
