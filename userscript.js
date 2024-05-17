// ==UserScript==
// @name         Jotoba Decker
// @namespace    https://github.com/ZedZagg
// @version      0.1
// @description  Build anki decks from Jotoba.de
// @author       ZedZagg
// @match        https://jotoba.de/*
// @icon         https://jotoba.de/JotoBook.png
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        GM.log

// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/master/src/FileSaver.js
// @require      https://raw.githubusercontent.com/Stuk/jszip/c00440a28addc800f924472bf351fc710e118776/dist/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js
// @require      https://raw.githubusercontent.com/ZedZagg/genanki-js-local/main/dist/genanki.js

// ==/UserScript==

(function() {
    'use strict';

    // observer to watch for the word list to be created
    let incomingWordObserver = new MutationObserver(observeInitialWords);
    const observerProperties = { attributes: false, childList: true, subtree: true }
    incomingWordObserver.observe(document, observerProperties)

    // find main header so we can add our anki menu button to it
    let mainHeaderObserver = new MutationObserver(initMainHeader);
    mainHeaderObserver.observe(document, observerProperties)

    // load saved word set
    let wordKeys = null;
    GM.listValues().then(
      (value) => { wordKeys = new Set(value);},
      () => { wordKeys = new Set(); }
    );

    // watches mutations from the first page load and adds buttons where necessary
    // once the word list is found, the observer is disconnected and a new one placed on the list
    function observeInitialWords(mutations, observer){
        for(const mutation of mutations){
            for(const node of mutation.addedNodes){
                if(node.classList && node.classList.contains("words")){
                    incomingWordObserver.disconnect(); // disconnect the observer before we add buttons or else we'll loop infinitely

                    for(const wordEntry of node.querySelectorAll('.word-entry'))
                        addAnkiButton(wordEntry);

                    // pivot the mutation observer to a new instance that watches only the word list
                    incomingWordObserver = new MutationObserver(observeAdditionalWords.bind(null, node));
                    incomingWordObserver.observe(node, observerProperties)
                    return;
                }
            }
        }
    }

    // watches mutations for changes to the word list
    // sometimes (like on refresh) this doesn't occur
    function observeAdditionalWords(observedNode, mutations, observer){
        observer.disconnect(); // gotta dc brb
        for(const mutation of mutations){
            for(const node of mutation.addedNodes){
                // sometimes we get text nodes so we need to filter to div.word-entry
                if(node.nodeName === "DIV" && node.classList.contains("word-entry")){
                    addAnkiButton(node)
                }
            }
        }
        observer.observe(observedNode, observerProperties); // back
    }

    // create, configure and add an "add to anki deck" button on a div.word-entry node
    function addAnkiButton(wordEntryNode){
        let headNode = wordEntryNode.querySelector('.entry-head');

        // get word value
        let word = { raw: "", key: ""};
        let ruby = headNode.querySelector('ruby');
        for(let i = 0; i < ruby.childNodes.length; i+=2){
            let raw = ruby.childNodes[i].textContent;
            let furigana = ruby.childNodes[i + 1].textContent;
            word.raw += raw;
            word.key += (furigana == "") ? raw : `[${raw}|${furigana}]`
        }

        // jank hack to get jlpt level
        let jlptLevel = [...headNode.querySelectorAll('.info-tag')]
                                ?.find(x => x.innerText.startsWith('N'))
                                ?.innerText ?? null

        // create/add anki button
        let ankiButton = document.createElement('button');
        ankiButton.style.backgroundImage = "url(https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Anki-icon.svg/800px-Anki-icon.svg.png)";
        ankiButton.style.backgroundRepeat = "no-repeat";
        ankiButton.style.backgroundSize = "contain";                               // >Oh you should use a class, styles are bad practise
        ankiButton.style.width = "15px";                                           // No, I won't.
        ankiButton.style.marginLeft = "auto";                                      // If it bothers you, you write the code.
        ankiButton.style.marginRight = "20px";

        // add/remove word from saved word set on click
        ankiButton.onclick = async () => {
            if(wordKeys.has(word.key)){
                await deleteWord(word.key);
                ankiButton.style.opacity = 0.5;
            }
            else{
                let wordData = await fetchWordDetails(word);
                wordData.jlptLevel = jlptLevel;
                wordData.raw = word.raw;
                await saveWord(wordData);
                ankiButton.style.opacity = 1.0;
            }
        }

        if(!wordKeys.has(word.key))
            ankiButton.style.opacity = 0.5;

        headNode.appendChild(ankiButton);
    }

    // fetch word details from jotoba backend
    async function fetchWordDetails(word){
        const query = {
                         "query": word.raw,
                         "language": "English",
                         "no_english": false
                      };
        const url = "https://jotoba.de/api/search/words";

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(query)
        });
        const data = await response.json();

        const relevantEntry = data.words.find(x => x.reading.furigana == word.key);
        if(!relevantEntry) throw new Error(`Server response did not contain details for ${word.key}`);
        return relevantEntry;
    }

    // populate the main header on the jotoba page with an anki menu button
    function initMainHeader(mutations, observer){
        const mainHeader = document.getElementById('mainHeader');
        if(mainHeader){
            GM.log("found main header", mainHeader)
            observer.disconnect()

            let ankiButton = document.createElement('button');
            ankiButton.style.backgroundImage = "url(https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Anki-icon.svg/800px-Anki-icon.svg.png)";
            ankiButton.style.backgroundRepeat = "no-repeat";
            ankiButton.style.backgroundSize = "contain";
            ankiButton.style.width = "40px";
            ankiButton.style.height = "45px";
            ankiButton.id = "anki-menu-button"
            ankiButton.onclick = saveFile

            function addAnkiMenuButton(){
                if(mainHeader.querySelector('#anki-menu-button')) return; // nothing to be done

                const parentEl = mainHeader.classList.contains("mobile") ?
                                     mainHeader.querySelector("div.right") :
                                     mainHeader.querySelector("div.top-row>div.utils-bundle");

                if(!parentEl){
                    GM.log("Failed to find element to attach anki menu button to in main header", mainHeader)
                    return;
                }

                parentEl.appendChild(ankiButton);
            }

            addAnkiMenuButton();

            let attributeChangeObserver = new MutationObserver(addAnkiMenuButton);
            mainHeaderObserver.observe(mainHeader, { attributes: true, childList: true, subtree: true });
        }
    }

    async function saveWord(wordData){
        const key = wordData.reading.furigana;
        if(wordKeys.has(key)){
            throw new Error(`word key ${key} already exists`)
        }
        await GM.setValue(key, wordData);
        wordKeys.add(key);
        GM.log(`Saved word: ${key}`)
    }

    async function deleteWord(wordKey){
        await GM.deleteValue(wordKey);
        wordKeys.delete(wordKey);
    }

    async function getWordData(wordKey){
        return await GM.getValue(wordKey, null)
    }

    async function purgeStorage(){
        const values = await GM.listValues();
        for(const value of values) await GM.deleteValue(value);
        wordKeys.clear();
    }

    async function saveFile(){
        // identifiers generated once with "+new Date" and hardcoded. This keeps it unique enough but consistent.
        const modelId = "1700793219903"
        const deckId = 1700793245715
        const sqlConfig = {
            locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm`
        }
        initSqlJs(sqlConfig).then(async function (sql) {
            var m = new Model({
                name: "Jotoba Card",
                id: modelId,
                flds: [
                    { name: "word" },
                    { name: "wordRuby" },
                    { name: "meaningsTable" },
                    { name: "pitches" },         // optional
                    { name: "isCommon" },        // optional
                    { name: "jlptLevel" },       // optional
                    { name: "audio" }            // optional

                ],
                req: [
                    // template index 0 must have fields index 0, 1 ,2. Tags are optional.
                    [ 0, "all", [ 0, 1, 2] ]
                ],
                tmpls: [
                    {
                        name: "Word",
                        qfmt: frontFormat,
                        afmt: backFormat,
                    }
                ],
                css: cardCSS
            })

            var deck = new Deck(263842878340, "Jotoba Cards")

            for(const key of wordKeys){
                const wordData = await getWordData(key)
                deck.addNote(m.note([
                    wordData.raw,
                    generateRuby(wordData),
                    generateMeaningsTable(wordData),
                    generatePitches(wordData),
                    wordData.common === true ? "true" : "",
                    wordData.jlptLevel,
                    wordData.audio
                ]))
            }

            var p = new Package()
            p.addDeck(deck)

            console.log("Attempting to save file", p)

            const zip = await p.generateZip('deck.apkg', sql)
            saveAs(zip, 'deck.apkg');
        });
    }

    function generateRuby(wordData){
        if(!wordData.reading.furigana) return `<ruby>${wordData.reading.kana}</ruby>`

        const furigana = wordData.reading.furigana              // example: "[男|おとこ]の[子|こ]"
        const characters = furigana.split(/\[([^\]]+)\]/)       //        : ["", "男|おとこ", "の", "子|こ", ""]
                                   .filter(x => x.length > 0)   //        : ["男|おとこ", "の", "子|こ"]
                                   .map(x => x.split('|'));     //        : [["男", "おとこ"], ["の"], ["子", "こ"]]

        let outputAccumulator = "<ruby>";
        for(const c of characters){
            outputAccumulator += c[0];
            outputAccumulator += `<rt>${c[1] ?? ""}</rt>`;
        }
        outputAccumulator += "</ruby>"
        return outputAccumulator;
    }

    function generateMeaningsTable(wordData){
        const senses = wordData.senses;
        let outputAccumulator = `<table class="meanings">`;
        for(const s of senses){
            outputAccumulator += `<tr class="sense"><td>`;
            outputAccumulator += s.information ? `${s.information}<br/>` : "";
            for(const p of s.pos){
                outputAccumulator += `${JSON.stringify(p)}<br/>`; // fuck it this schema doesn't exist
            }
            outputAccumulator += `</td><td class="gloss">`;
            for(const g of s.glosses){
                outputAccumulator += `${g}<br/>`;
            }
            outputAccumulator += `</td></tr>`;
        }
        outputAccumulator += "</table>"
        return outputAccumulator;
    }

    function generatePitches(wordData){
        const pitches = wordData.pitch
        if(!pitches) return null

        let outputAccumulator = '<div class="pitches">';

        for(const character of pitches){
           const pitch = character.high ? 'high' : 'low';
           outputAccumulator += `<span class="${pitch}">${character.part}</span>`;
        }

        outputAccumulator += "</div>";

        return outputAccumulator;
    }



    const frontFormat = `
<div class="main">
  <div class="tags">
    <div class="common"{{^isCommon}}style="display: none"{{/isCommon}}>C</div>
    <div class="jlpt" {{^jlptLevel}}style="display: none"{{/jlptLevel}}>{{jlptLevel}}</div>
  </div>
  <div class="mainWord">
    {{word}}
  </div>
</div>
`;

    const backFormat =`
<div class="main">
  <div class="tags">
    <div class="common"{{^isCommon}}style="display: none"{{/isCommon}}>C</div>
    <div class="jlpt" {{^jlptLevel}}style="display: none"{{/jlptLevel}}>{{jlptLevel}}</div>
  </div>
  <div class="mainWord">
    {{wordRuby}}
  </div>
</div>

<hr/>

<div class="pitchContainer">
  Pitches{{pitches}}
</div>

{{meaningsTable}}
<audio controls src="https://jotoba.de{{audio}}"></audio>
`;


    const cardCSS =`
.card {
  font-family: Overpass,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,sans-serif;
  font-size: 20px;
  text-align: center;
  color: black;
  background-color: white;
}

.tags {
  position: absolute;

	>div {
		height: 31px;
		width: 31px;
		border-radius: 50%;
		margin-bottom: 5px;
	}

	.jlpt{
		background-color: #434674;
	}
	.common{
		background-color: #216125;
	}
}

.main {
  height: 80px;
  position: relative;
}

.mainWord {
  font-size: 50px;
  position: absolute;
  bottom: 0px;
  width: 100%
}

.pitchContainer {
  float: right;
  margin-right: 20px;
  margin-left: 20px;
  color: grey;
}

.pitches {
  color: green;

  .high {
    border-top: 1px solid grey;

	+ .low {
	  border-left: 1px solid grey
    }
  }

  .low {
    border-bottom: 1px solid grey;

    + .high {
      border-left: 1px solid grey
    }
  }
}

tr:nth-child(even) {
		background: rgba(200,200,200,0.1);
}

.meanings {
  overflow-y: scroll;
  height: 250px;
  display: block;

  :nth-child(2){
	}

  .sense{
    width: 60px;
    text-align: left;
  }
  .gloss{
    text-align: right;
  }
}

audio {
	padding-top: 20px;
}
`

})();
