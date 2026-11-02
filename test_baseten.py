import os, json, urllib.request

req = urllib.request.Request(
    "https://inference.baseten.co/v1/chat/completions",
    data=json.dumps({
        "model": "meta-models/muse-spark-open-1026",
        "messages": [{"role": "user", "content": "Hello!"}],
    }).encode(),
    headers={
        "Authorization": "Bearer " + os.environ["BASETEN_API_KEY"],
        "Content-Type": "application/json",
    },
)
with urllib.request.urlopen(req, timeout=60) as r:
    print(json.load(r)["choices"][0]["message"]["content"])
