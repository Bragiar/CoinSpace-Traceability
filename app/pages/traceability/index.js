'use strict';

var Ractive = require('lib/ractive');
var Big = require('big.js');
var emitter = require('lib/emitter');
var db = require('lib/db');
var getWallet = require('lib/wallet').getWallet;
var getTokenNetwork = require('lib/token').getTokenNetwork;
var showError = require('widgets/modals/flash').showError;
var showInfo = require('widgets/modals/flash').showInfo;
var showConfirmation = require('widgets/modals/confirm-send');
var showTooltip = require('widgets/modals/tooltip');
var validateSend = require('lib/wallet').validateSend;
var getDynamicFees = require('lib/wallet').getDynamicFees;
var resolveTo = require('lib/openalias/xhr.js').resolveTo;
var qrcode = require('lib/qrcode');
var bchaddr = require('bchaddrjs');


module.exports = function(el) {
    var selectedFiat = '';
    var defaultFiat = 'USD';

    var selectedUnspentTxId = '';

    var ractive = new Ractive({
        el: el,
        template: require('./index.ract'),
        data: {
            currencies: [],
            selectedFiat: defaultFiat,
            exchangeRates: {},
            qrScannerAvailable: qrcode.isScanAvailable,
            isEthereum: false,
            validating: false,
            gasLimit: '',
            selectedDonation: { name: 'None', address: '' },
            donationAddresses: {},
            traceabilityUnspents: []
        }
    })

    emitter.on('prefill-wallet', function(address, context) {
        if (context !== 'send') return;
        ractive.set('to', address)
    })

    emitter.on('prefill-value', function(value, context) {
        if (context !== 'send') return;
        ractive.find('#bitcoin').value = value;
        ractive.fire('bitcoin-to-fiat')
    })

    ractive.on('before-show', function() {
        ractive.set('isEthereum', getTokenNetwork() === 'ethereum');
    });

    ractive.on('open-qr', function() {
        qrcode.scan({ context: 'send' });
    })

    ractive.on('open-geo', function() {
        var data = {
            overlay: 'geo',
            context: 'send'
        }
        emitter.emit('open-overlay', data)
    })

    ractive.on('continue_traceability', function(){
      ractive.set('continue_traceability',true);
      ractive.set('new_traceability',false);
    })

    ractive.on('new_traceability', function(){
      ractive.set('new_traceability',true);
      ractive.set('continue_traceability',false);
    })

    emitter.on('header-fiat-changed', function(currency) {
        ractive.set('selectedFiat', currency)
    })

    ractive.on('open-send-data', function() {
        ractive.set('validating', true);
        var to = ractive.get('to');
        var text = ractive.get('data');
        resolveTo(to, function(data) {
            fixBitcoinCashAddress(data);
            getDynamicFees(function(dynamicFees) {
                validateAndShowConfirm(data.to, data.alias, dynamicFees, null);
            });
        })
    })

    emitter.on('wallet-ready', function() {
        ractive.set('denomination', getWallet().denomination);
        ractive.set('gasLimit', getWallet().gasLimit);
        var unspents = getWallet().unspents
        var historyTxs = getWallet().historyTxs
        console.log(unspents)
        console.log(historyTxs)

        // traceability
        var unspents_traceability = [];
        if (!unspents) {
            unspents = new Array();
        }
        if (!historyTxs) {
            historyTxs = new Array();
        }
        for (var i = 0; i < unspents.length; i++) {
          for (var j = 0; j < historyTxs.length; j++) {
            if(unspents[i].txId == historyTxs[j].txId){
              for (var k = 0; k < historyTxs[j].vout.length; k++) {
                if(historyTxs[j].vout[k].scriptPubKey.type == 'nulldata'){

                  if(!(unspents_traceability.filter(e => e.txId === historyTxs[j].txId).length > 0)){
                    console.log(historyTxs[j].vout[k].scriptPubKey)
                    var unspent_trace = {
                      txId : historyTxs[j].txId,
                      op_ret: parseOpRet(historyTxs[j].vout[k].scriptPubKey.hex),
                      unspent: unspents[i]
                    };
                    unspents_traceability.push(unspent_trace)
                  }
                }
              }
            }
          }
        }

        ractive.set('unspents_traceability',unspents_traceability)
        ractive.set('traceabilityUnspents',unspents_traceability);
    });

    emitter.once('ticker', function(rates) {
        var currencies = Object.keys(rates);
        initPreferredCurrency(currencies);
        ractive.set('currencies', currencies);
        ractive.set('exchangeRates', rates);
        ractive.fire('bitcoin-to-fiat');

        emitter.on('ticker', function(rates) {
            var currencies = Object.keys(rates);
            if (currencies.indexOf(selectedFiat) === -1) {
                selectedFiat = defaultFiat;
                ractive.set('selectedFiat', selectedFiat);
            }
            ractive.set('currencies', currencies);
            ractive.set('exchangeRates', rates);
            ractive.fire('bitcoin-to-fiat');
        });
    })

    emitter.once('wallet-ready', function() {
        checkUrlForPrefill()
    })

    function initPreferredCurrency(currencies) {
        var systemInfo = db.get('systemInfo');
        selectedFiat = systemInfo.preferredCurrency;
        if (currencies.indexOf(selectedFiat) === -1) {
            selectedFiat = defaultFiat;
        }
        ractive.set('selectedFiat', selectedFiat);
        ractive.observe('selectedFiat', setPreferredCurrency)
    }

    ractive.on('fiat-to-bitcoin', function() {
        var fiat = ractive.find('#fiat').value;
        if (!fiat) return;

        var exchangeRate = ractive.get('exchangeRates')[ractive.get('selectedFiat')];
        var bitcoin = '0';
        if (exchangeRate) {
            bitcoin = new Big(fiat).div(exchangeRate).toFixed(8)
        }
        ractive.find('#bitcoin').value = bitcoin;
    })

    ractive.on('bitcoin-to-fiat', function() {
        var bitcoin = ractive.find('#bitcoin').value;
        if (!bitcoin) return;

        var exchangeRate = ractive.get('exchangeRates')[ractive.get('selectedFiat')];
        if (typeof exchangeRate !== 'number') return;

        var fiat = new Big(bitcoin).times(exchangeRate).toFixed(2);
        ractive.find('#fiat').value = fiat;
    })

    ractive.on('clearTo', function() {
        var passfield = ractive.find('#to')
        ractive.set('to', '')
        passfield.focus()
    })

    ractive.on('focusAmountInput', function(context) {
        context.node.parentNode.style.zIndex = 5000
    })

    ractive.on('blurAmountInput', function(context) {
        context.node.parentNode.style.zIndex = ''
    })

    ractive.on('help-gas-limit', function() {
        showTooltip({
            message: 'Gas limit is the amount of gas to send with your transaction. ' +
                'Increasing this number will not get your transaction confirmed faster. ' +
                'Sending ETH is equal 21000. Sending Tokens is equal around 200000.'
        })
    })

    ractive.on('select-unspent', function() {
        var unspent = ractive.get("selectedUnspent");
        ractive.set("to", unspent);
        ractive.set("unspent_txId", unspent);
    })

    function validateAndShowConfirm(to, alias, dynamicFees, amount) {
        if (amount != null) {
            emitter.emit('prefill-value', amount, 'send');
        }
        var amount = ractive.find('#bitcoin').value;
        var text;
        if (ractive.get("new_traceability")){
          text = "Traceability:" + ractive.find('#batch').value + ';' + ractive.find('#ship').value  + ';' + ractive.find('#loc').value;
          console.log("new traceability transaction")
        } else {
          text = ractive.find('#batch').value + ';' + ractive.find('#ship').value  + ';' + ractive.find('#loc').value;
        }
        var wallet = getWallet();
        var unspents = wallet.unspents
        var unspents_traceability = ractive.get('traceabilityUnspents');
        var unspents_notTraceability = unspents.filter(({ address }) =>
        !unspents_traceability.some(exclude => exclude.unspent.address == address)
        )
        console.log("unspents not with traceability")
        console.log(unspents_notTraceability)
        console.log("unspents with traceability")
        console.log(unspents_traceability)
        if (unspents_notTraceability.length == 0) {
          return showError({title: 'Uh Oh...',message: 'You need to top up your wallet with some smileycoins for the transaction fee'})
        }


        var unspents_traceandfee = [];

        if (ractive.get("new_traceability")) {
          unspents_traceandfee = unspents_notTraceability;

        } else {

          for (var i = 0; i < unspents_traceability.length; i++) {
            if(unspents_traceability[i].txId == ractive.get("selectedUnspent")){
              unspents_traceandfee.push(unspents_traceability[i].unspent);
              break;
            }
          }
          //var unspents_traceandfee = ractive.get("selectedUnspent");
          console.log(unspents_traceandfee)

          var minvalue = 100000000 // 1 smly
          var maxvalue = 1000000000 // 10 smly
          var value = 0
          for (var i = 0; i < unspents_notTraceability.length; i++) {
            //if (!(unspents_notTraceability[i].value > maxvalue)) {
              value += unspents_notTraceability[i].value;
              unspents_traceandfee.push(unspents_notTraceability[i])
              //console.log(unspents_notTraceability[i])
              console.log("Total amount for fee:");
              console.log(value/minvalue)
              if(value >= minvalue) {
                console.log("got enough for fee!")
                break;
              }
          //  }
          }
          console.log(value)
        }
        console.log("unspents used for transaction:")
        console.log(unspents_traceandfee)
        ractive.set("unspents_traceandfee",unspents_traceandfee);
        //var m = ractive.get("unspents_traceandfee",unspents_traceandfee);
        console.log(ractive.get("unspents_traceandfee"))

        //ractive.find('#bitcoin').value = 20000
        if (wallet.networkName === 'ethereum') {
            wallet.gasLimit = ractive.find('#gas-limit').value;
        }
        validateSend(wallet, to, amount, text, dynamicFees, unspents_traceandfee, function(err) {
            ractive.set('validating', false);
            if (err) {
                var interpolations = err.interpolations
                if (err.message.match(/trying to empty your wallet/)) {
                    ractive.find('#bitcoin').value = interpolations.sendableBalance;
                    return showInfo({ message: err.message, interpolations: interpolations })
                }
                return showError({ title: 'Uh Oh...', message: err.message, fee: err.fee, href: err.href, linkText: err.linkText, interpolations: interpolations })
            }

            showConfirmation({
                to: to,
                alias: alias,
                amount: ractive.find('#bitcoin').value, // don't change this to amount. 'value' could be modified above
                text: text,
                denomination: ractive.get('denomination'),
                dynamicFees: dynamicFees,
                unspents_traceandfee: ractive.get('unspents_traceandfee'),
                onSuccessDismiss: function() {
                    ractive.set({ to: '' });
                    ractive.find('#bitcoin').value = '';
                    ractive.find('#fiat').value = '';
                }
            })
        })
    }

    function setPreferredCurrency(currency, old) {
        if (old === undefined) return; // when loading wallet

        emitter.emit('send-fiat-changed', currency)
        ractive.fire('bitcoin-to-fiat')
    }

    function fixBitcoinCashAddress(data) {
        if (getTokenNetwork() !== 'bitcoincash') return;
        try {
            var legacy = bchaddr.toLegacyAddress(data.to);
            if (legacy !== data.to) {
                data.alias = data.to;
                data.to = legacy;
            }
        } catch (e) {}
    }

    function parseOpRet(hexx){
          hexx = hexx.substr(4);
          var hex = hexx.toString();//force conversion
          var str = '';
          for (var i = 0; (i < hex.length && hex.substr(i, 2) !== '00'); i += 2)
              str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
          return str;
    }

    function checkUrlForPrefill() {
        var loc = window.location.search
        loc = loc.split('&')
        if (loc.length > 2) {
            var add = loc[1].split('=')[1]
            var amount = loc[2].split('=')[1]
            ractive.set('validating', true);
            var to = ractive.get('to');
            resolveTo(to, function(data) {
                fixBitcoinCashAddress(data);
                getDynamicFees(function(dynamicFees) {
                    validateAndShowConfirm(add, data.alias, dynamicFees, amount);
                });
            })
        }
    }
    return ractive
}
