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
        ankiButton.onclick = async () => {
            let data = await fetchWordDetails(word);
            console.log(data)
        }
        headNode.appendChild(ankiButton);

    }

    function createAnkiCardString(wordDetails){

    }

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
        return data.words[0];
    }

    function initMainHeader(mutations, observer){
        const mainHeader = document.getElementById('mainHeader');
        if(mainHeader){
            observer.disconnect()

            function addAnkiMenuButton(){
                if(mainHeader.querySelector('#anki-menu-button')) return; // nothing to be done

                let ankiButton = document.createElement('button');
                ankiButton.style.backgroundImage = "url(https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Anki-icon.svg/800px-Anki-icon.svg.png)";
                ankiButton.style.backgroundRepeat = "no-repeat";
                ankiButton.style.backgroundSize = "contain";
                ankiButton.style.width = "40px";
                ankiButton.id = "anki-menu-button"
                ankiButton.onclick = async () => {
                    console.log(wordSet);
                }

                if(mainHeader.classList.contains("mobile")){ // mobile layout
                    mainHeader.appendChild(ankiButton);
                }
                else{ // desktop layout
                    const parentEl = mainHeader.querySelector("div.top-row>div.gap");
                    if(parentEl)
                        parentEl.appendChild(ankiButton);
                }
            }

            addAnkiMenuButton();

            let attributeChangeObserver = new MutationObserver(addAnkiMenuButton);
            mainHeaderObserver.observe(mainHeader, { attributes: true, childList: true, subtree: true });
        }
    }
})();
