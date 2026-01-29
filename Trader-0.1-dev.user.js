// ==UserScript==
// @name         Trader
// @namespace    http://tampermonkey.com/
// @version      0.1-dev
// @description  try to take over the world!
// @author       You
// @match        https://ru.tradingview.com/chart/pkIdB1nN/*
// @match        https://m.pocketoption.com/ru/cabinet/*
// @match        https://pocketoption.com/ru/cabinet/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tradingview.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdn.socket.io/4.7.5/socket.io.min.js
// @run-at       document-end
// ==/UserScript==
/* global JSZip */
/* global io */

(async function() {
    'use strict';

    const cleanerRgx = /~h~/g;
    const splitterRgx = /~m~[0-9]{1,}~m~/g;

    function parseWSPacket(str) {
        return str.replace(cleanerRgx, '').split(splitterRgx)
            .map((p) => {
            if (!p) return false;
            try {
                return JSON.parse(p);
            } catch (error) {
                console.warn('Cant parse', p);
                return false;
            }
        })
            .filter((p) => p);
    }

    async function parseCompressed(data) {
        const zip = new JSZip();
        return JSON.parse(
            await (
                await zip.loadAsync(data, { base64: true })
            ).file('').async('text'),
        );
    }

    function waitForPath(getter, interval = 500, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();

            const id = setInterval(() => {
                const value = getter();
                if (value !== undefined && value !== null) {
                    clearInterval(id);
                    resolve(value);
                } else if (Date.now() - start >= timeout) {
                    clearInterval(id);
                    reject(new Error('Timeout waiting for path'));
                }
            }, interval);
        });
    }

    /*waitForPath(() => window.WSBackendConnection)
        .then(() => console.log("Trader ready, connection found"))
        .catch(error => console.log("Error occured:", error));

    const websocket = window.WSBackendConnection;
    var packetIndex = 0;

    websocket.on("message", (event) => {
        var parsedPacket = parseWSPacket(event);
        parsedPacket.forEach((e) => {
            if (e.m === "du") {
                const ticker = e.p[1];
                console.log(ticker);
                const indicators = Object.keys(ticker);
                indicators.forEach(indicator => {
                    var data = ticker[indicator].ns.d;
                    if (data && data !== '') {
                        parseCompressed(JSON.parse(data).dataCompressed).then((info) => {
                            console.log(info);
                        });
                    }
                });
            };
        });
    });*/

    GM_setValue("new_trade_event", "hi");

    switch (location.host) {
        case "ru.tradingview.com":
            processTradingView();
            break;
        case "m.pocketoption.com":
            processPocketOption();
            break;
        case "pocketoption.com":
            processPocketOption();
    }

    async function processTradingView() {
        function processNewSignal() {
            var newSignalRow = document.querySelector("#bottom-area > div.bottom-widgetbar-content.backtesting > div > div > div > div > div > div.ka > div > table > tbody > tr:nth-child(2)");
            var data = newSignalRow.querySelectorAll('td.ka-cell > div > span');
            var type = data[1].className.startsWith("long") ? "long" : "short";
            console.log(+data[0].innerHTML, type, newSignalRow);
            GM_setValue("new_trade_event", { ts : Date.now(), id : +data[0].innerHTML, type : type });
        }

        var dealsTable = (await waitForPath(() => document.querySelector("#bottom-area > div.bottom-widgetbar-content.backtesting > div > div > div > div > div > div.ka > div > table > tbody > tr:nth-child(2)"))).parentNode;

        const tableObserver = new MutationObserver(function(mutationsList, observer) {
            for(const mutation of mutationsList) {
                if (mutation.addedNodes.length !== 0) {
                    processNewSignal();
                }
                if (mutation.removedNodes.length !== 0) {
                    console.log("Nodes removed", mutation.removedNodes[0]);
                }
            }
        });

        tableObserver.observe(dealsTable, { attributes: true, childList: true, subtree: true });
    }

    function handleRecievedData(data) {
        console.log(data);
    }

    function processPocketOption() {
        let __SESSION_ID__ = "ENTER_ID";
        GM_addValueChangeListener("new_trade_event", (key, oldVal, newVal, remote) => {
            console.log('CHANGE on', location.host, { key, oldVal, newVal, remote });

            const exec_script = document.createElement("script");
            exec_script.textContent = `
            (function () {
            let tries = 3;
            function exec_order(order) {
                const socket = window.__PO_SOCKET__;
                if (!socket.connected || !socket.authenticated) {
                    if (tries--) {
                        setTimeout(exec_order, 1000, order);
                    }
                    return;
                }
                socket.emit("openOrder", {
                    asset:"EURUSD",
                    amount:1,
                    action: order === "long" ? "call" : "put",
                    isDemo:1,
                    requestId: Date.now(),
                    optionType:100,
                    time:60
                });
            };
            window.__DO_PO_SOCKET__();
            exec_order(${JSON.stringify(newVal)});
            })();`;
            document.documentElement.appendChild(exec_script);
            exec_script.remove();
        });

        var s = document.createElement("script");
        s.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";

        s.onload = () => {
            const ws_script = document.createElement("script");
            ws_script.textContent = `
      (function () {
        function conn_n_auth() {
            if (window.__PO_SOCKET__ && window.__PO_SOCKET__.connected) {
                return;
            }

            if (!window.io) {
                console.error("io not found");
                return;
            }

            const socket = io("wss://demo-api-eu.po.market/", {
                path: "/socket.io",
                transports: ["websocket"]
            });

            socket.on("connect", () => {
                console.log("[TRADER] connected", socket.id);
                socket.emit("auth", {
                    session: ${__SESSION_ID__},
                    isDemo: 1,
                    uid: 62124847,
                    platform: 2,
                    isFastHistory: true,
                    isOptimized: true
                });
            });

            socket.on("connect_error", (err) => {
                console.error("[TRADER] connect_error", err.message);
            });

            socket.on("successauth", (msg) => {
                const json = JSON.parse(new TextDecoder().decode(msg));
                console.log("[TRADER] EVENT successauth: ", json);
                /*socket.emit("changeSymbol",{
                    "asset":"EURUSD",
                    "period":1
                });*/
                socket.authenticated = true;
            });

            socket.onAny((event, ...args) => {
                //console.log("[TRADER] EVENT:", event, args);
                //const json = JSON.parse(new TextDecoder().decode(args[0]));
                //console.log("[TRADER] EVENT:", event, json);
            });

            window.__PO_SOCKET__ = socket;
        };

        window.__DO_PO_SOCKET__ = conn_n_auth;
        window.__DO_PO_SOCKET__();

      })();`;
            document.documentElement.appendChild(ws_script);
            ws_script.remove();
        }

        document.head.appendChild(s);
    }

})();