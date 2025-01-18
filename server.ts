import "@std/dotenv/load";

import * as path from "@std/path";

const devicePath = Deno.env.get("DEVICE_PATH") ?? "";

const __dirname = path.dirname(path.fromFileUrl(import.meta.url));

const getLibrayPath = (dir: string, name: string) => {
  let libSuffix = "";
  switch (Deno.build.os) {
    case "windows":
      libSuffix = "dll";
      break;
    case "darwin":
      libSuffix = "dylib";
      break;
    default:
      libSuffix = "so";
      break;
  }

  return path.resolve(
    path.join(
      dir,
      `${(Deno.build.os === "windows" ? "" : "lib")}${name}.${libSuffix}`,
    ),
  );
};

const getLibrary = () => {
  // 環境ごとに違う拡張子に対応する。

  return Deno.dlopen(
    getLibrayPath(path.join(__dirname, "/lib"), "ud_co2s"),
    {
      "register_callback": { parameters: ["pointer"], result: "void" },
      "open": { parameters: ["pointer"], result: "void" },
      "close": { parameters: [], result: "void" },
    },
  );
};

const list: {
  date: number;
  co2ppm: number;
  temperature: number;
  humidity: number;
}[] = [];

const library = getLibrary();

// ライブラリを読み込む
const cb = new Deno.UnsafeCallback({
  parameters: ["pointer", "usize"],
  result: "void",
}, (ptr, len) => {
  if (!ptr) {
    return;
  }

  const message = new TextDecoder().decode(
    new Uint8Array(
      Deno.UnsafePointerView.getArrayBuffer(ptr, parseInt(len.toString())),
    ),
  ).trim();

  if (!message.startsWith("CO2")) {
    return;
  }

  const data = Object.fromEntries(
    message.split(",", 3).map((v) => v.split("=", 2)),
  );
  const raw = {
    co2: Number.parseInt(data.CO2, 10),
    hum: Number.parseInt(data.HUM, 10),
    tmp: Number.parseInt(data.TMP, 10),
  };

  if (Object.values(raw).some((v) => Number.isNaN(v))) {
    return;
  }

  const co2ppm = raw.co2;
  const temperature = raw.tmp - 4.5;
  const humidity = ((216.7 *
    (raw.hum / 100 * 6.112 *
      Math.pow(2.71828, (17.62 * raw.tmp) / (243.12 + raw.tmp))) /
    (273.15 + raw.tmp)) * (273.15 + temperature)) /
    (216.7 * 6.112 *
      Math.pow(2.71828, (17.62 * temperature) / (243.12 + temperature))) *
    100;

  list.unshift({ date: new Date().getTime(), co2ppm, temperature, humidity });
  if (list.length > 100) {
    list.splice(0, list.length - 100);
  }
});

// コールバックを登録。
library.symbols.register_callback(cb.pointer);

// シリアルポートを開く。
library.symbols.open(
  Deno.UnsafePointer.of(
    new Uint8Array(new TextEncoder().encode(devicePath + "\0")),
  ),
);

export default {
  fetch: (req: Request) => {
    const url = new URL(req.url);

    if (url.pathname === "/current") {
      const current = list.at(-1);
      return Response.json(current ?? { status: 404 }, {
        status: current ? 200 : 404,
      });
    }

    if (url.pathname === "/history") {
      return Response.json(list);
    }

    return Response.json({ status: 404 }, { status: 404 });
  },
};
