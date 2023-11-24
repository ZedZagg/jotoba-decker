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
    let wordSet;
    getWordList().then(value => { wordSet = value; });

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
        let word = "";
        let ruby = headNode.querySelector('ruby');
        for(let node of ruby.childNodes.entries()){
            if(node[1].nodeName === "#text") word += node[1].textContent;
        }

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
            if(wordSet.includes(word)){
                await deleteWord(word);
                ankiButton.style.opacity = 0.5;
            }
            else{
                let wordData = await fetchWordDetails(word);
                await saveWord(wordData);
                ankiButton.style.opacity = 1.0;
            }
        }

        if(wordSet && !wordSet.includes(word))
            ankiButton.style.opacity = 0.5;

        headNode.appendChild(ankiButton);
    }

    function createAnkiCardString(wordDetails){

    }

    // fetch word details from jotoba backend
    async function fetchWordDetails(word){
        const query = {
                         "query": word,
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
        const relevantEntry = data.words.find(x => getWordText(x) == word)
        if(!relevantEntry) throw new Error(`Server response did not contain details for ${word}`);
        return relevantEntry;
    }

    // populate the main header on the jotoba page with an anki menu button
    function initMainHeader(mutations, observer){
        const mainHeader = document.getElementById('mainHeader');
        if(mainHeader){
            console.log("found main header", mainHeader)
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
                    console.error("Failed to find element to attach anki menu button to in main header", mainHeader)
                    return;
                }

                parentEl.appendChild(ankiButton);
            }

            addAnkiMenuButton();

            let attributeChangeObserver = new MutationObserver(addAnkiMenuButton);
            mainHeaderObserver.observe(mainHeader, { attributes: true, childList: true, subtree: true });
        }
    }

    function getWordText(wordData){
        return wordData.reading.kanji ?
            wordData.reading.kanji :
            wordData.reading.kana
    }

    async function saveWord(wordData){
        const key = getWordText(wordData)
        await GM.setValue( key, wordData);
        wordSet = await getWordList();
    }

    async function deleteWord(wordText){
        var index = wordSet.indexOf(wordText);
        if (index !== -1) {
            wordSet.splice(index, 1);
        }
        await GM.deleteValue(wordText);
    }

    async function getWordData(wordText){
        return await GM.getValue(wordText, null)
    }

    async function getWordList(){
        return await GM.listValues();
    }

    async function purgeStorage(){
        const values = await GM.listValues();
        for(const value of values) await GM.deleteValue(value);
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
                    { name: "wordRuby" },
                    { name: "meaningsTable" },
                    { name: "pitches" },
                    { name: "tags" }

                ],
                req: [
                    // template index 0 must have fields index 0, 1 ,2. Tags are optional.
                    [ 0, "all", [ 0, 1, 2 ] ]
                ],
                tmpls: [
                    {
                        name: "Word",
                        qfmt: "{{Front}}",
                        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
                    }
                ],
            })

            var deck = new Deck(263842878340, "Jotoba Cards")

            for(const key of wordSet){
                const wordData = await getWordData(key)
                deck.addNote(m.note([
                    generateRuby(wordData),
                    "meaningsTable",
                    "pitches",
                    "tags"
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
        const furigana = wordData.reading.furigana              // example: "[男|おとこ]の[子|こ]"
        const characters = furigana.split(/\[([^\]]+)\]/)       //        : ["", "男|おとこ", "の", "子|こ", ""]
                                   .filter(x => x.length > 0)   //        : ["男|おとこ", "の", "子|こ"]
                                   .map(x => x.split('|'));     //        : [["男", "おとこ"], ["の"], ["子", "こ"]]

        let outputAccumulator = "<ruby>";
        for(const c of characters){
            outputAccumulator += c[0]
            if(c[1]) outputAccumulator += `<rt>${c[1]}</rt>`
        }
        return outputAccumulator;
    }

})();
