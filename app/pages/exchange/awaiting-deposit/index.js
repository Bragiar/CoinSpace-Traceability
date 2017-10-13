'use strict';

var Ractive = require('lib/ractive');
var emitter = require('lib/emitter');
var showQr = require('widgets/modal-qr');
var qrcode = require('lib/qrcode');
var db = require('lib/db');
var shapeshift = require('lib/shapeshift');
var showError = require('widgets/modal-flash').showError;
var translate = require('lib/i18n').translate;

module.exports = function(el) {
  var ractive = new Ractive({
    el: el,
    template: require('./index.ract'),
    data: {
      depositAddress: '-',
      depositSymbol: '',
      depositCoinName: '',
      depositMax: '',
      depositMin: '',
      toSymbol: '',
      toAddress: '',
      isLoadingMarketInfo: true,
      isSocialSharing: process.env.BUILD_TYPE === 'phonegap' && window.plugins && window.plugins.socialsharing,
    },
    partials: {
      loader: require('../loader.ract'),
      footer: require('../footer.ract')
    }
  });

  ractive.on('before-show', function(context) {
    ractive.set({
      depositAddress: context.depositAddress,
      depositSymbol: context.depositSymbol,
      depositCoinName: context.depositCoinName,
      toSymbol: context.toSymbol,
      toAddress: context.toAddress,
      isLoadingMarketInfo: true
    });
    showQRcode();
    shapeshift.marketInfo(context.depositSymbol, context.toSymbol).then(function(data) {
      ractive.set('isLoadingMarketInfo', false);
      ractive.set('depositMax', data.limit);
      ractive.set('depositMin', data.minimum);
    }).catch(function(err) {
      ractive.set('isLoadingMarketInfo', false);
      console.error(err.message);
      return showError({message: err.message});
    });
  });

  ractive.on('cancel', function() {
    db.set('exchangeInfo', null, function(err) {
      if (err) return console.error(err);
      emitter.emit('change-exchange-step', 'create');
    });
  });

  ractive.on('show-qr', function(){
    if (ractive.get('isSocialSharing')) {
      window.plugins.socialsharing.shareWithOptions({
        message: ractive.get('depositAddress')
      }, function() {
        if (window.FacebookAds && window.FacebookAds.fixBanner) {
          window.FacebookAds.fixBanner();
        }
      });
    } else {
      showQr({
        address: ractive.get('depositAddress'),
        name: ractive.get('depositCoinName').toLowerCase(),
        title: translate('Deposit address', {symbol: ractive.get('depositSymbol')})
      });
    }
  })

  function showQRcode() {
    if (ractive.get('isSocialSharing')) {
      var canvas = ractive.find('#deposit_qr_canvas');
      while (canvas.hasChildNodes()) {
        canvas.removeChild(canvas.firstChild);
      }
      var name = ractive.get('depositCoinName').toLowerCase();
      var qr = qrcode.encode(name + ':' + ractive.get('depositAddress'));
      canvas.appendChild(qr);
    }
  }

  return ractive;
}
