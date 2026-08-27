# Who Graphe says it is

`client.json` is how Graphe identifies itself to a tool server that asks
somebody to sign in — a Client ID Metadata Document (SEP-991). The URL of this
file *is* the client id: a server that supports it fetches this document instead
of handing out a fresh registration, so there is one Graphe rather than one per
machine, and a server operator has something stable to recognise.

It has to stay reachable at exactly `https://usegraphe.com/oauth/client.json`, over
https, and it has to keep saying that id. Moving it breaks every sign-in already
held on somebody's machine.

The redirect addresses carry no port on purpose. The app listens on whichever
one the operating system gives it and puts that in the request; RFC 8252 §7.3
requires an authorisation server to accept any port for a loopback address. A
port written down here would be wrong on the second launch.

Servers that have not implemented this fall back to registering the app
themselves, which needs nothing here.
