# Scorch Tanks

A tiny browser artillery game for exactly two network players.

## Run

```sh
npm start
```

Open `http://localhost:3000` in two browsers or on two devices that can reach the host.

The default game code is `scorch`. Override it before starting the server:

```sh
GAME_TOKEN=my-secret-code npm start
```

## Controls

- Left / right arrows: aim
- Up / down arrows: power
- Space: fire
- R: restart the match
