const functions = require('firebase-functions');
var stripe = require("stripe")("sk_test_9YgUPJIi44UxQ9Rr3JqQ7I20");


const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

exports.printSomething = functions.database
.ref('user')
.onWrite((event) => {
    console.log("Something Changed")
});

exports.createCard = functions.database.ref('user/{userID}/cards/{cardID}').onCreate((snap, context) => {
    console.log("Create Card");
    console.log("Create Value: " + snap.val());
    const card = snap.val()
    if(card.valid === 100) {
        
    }
  
});


exports.getStripeCustomerId = functions.database.ref('user/{userID}').onCreate((snap, context) => {
    console.log("Create StripeId" + snap.val().emailAddress);
  
    stripe.customers.create(
        { email: snap.val().emailAddress },
        function(err, customer) {
          err; // null if no error occurred
          customer; // the created customer object
          if(err != null) {console.log("Error: " + JSON.stringify(err))}
          if(customer != null) {
              const customerId = customer.id
              console.log("Customer: " + JSON.stringify(customer.id));
            snap.ref.child('stripeId').set(customerId);
            console.log("StripeId set " + customerId);
          }
        }
      );
/*
        const customer = stripe.customers.create({
          email: snap.val().emailAddress,
        });
        console.log("StripeId: " + customer.getStripeCustomerId);

        return snap.ref.child('stripeId').set(customer.getStripeCustomerId); */
});

exports.updateDefaultSource = functions.database.ref('user/{userID}/srcId').onWrite((snap, context) => {

    console.log("updateDefaultSource " + JSON.stringify(snap));

    const srcId = snap.after.val();



    var db = admin.database();
    var ref = db.ref(snap.after.ref.parent.child('stripeId'));

    // Attach an asynchronous callback to read the data at our posts reference
    ref.on("value", function(snapshot) {
        console.log(snapshot.val());
        var user = snapshot.val();

        stripe.customers.createSource(user, {
            source: srcId
          }, function(err, source) {
            if(err != null) {console.log("Error: " + JSON.stringify(err))}
                if(source != null) {

                console.log("Source save " + JSON.stringify(source));

                stripe.customers.update(user, {
                    default_source: srcId,
                  }, function(err, customer) {
                    if(err != null) {console.log("Error: " + JSON.stringify(err))}
                        if(customer != null) {
        
                        console.log("Source save " + JSON.stringify(customer));
                        }
                  });
                }
          });

        
        });
    });


/*

        stripe.customers.update(user, srcId,
            function(err, response) {
                if(err != null) {console.log("Error: " + JSON.stringify(err))}
                if(response != null) {

                console.log("Source save " + JSON.stringify(response));
            }
          }
        );
    }, function (errorObject) {
    console.log("The read failed: " + errorObject.code);
    });


    firebase.database.ref(snap.after.ref.parent.child('stripeId')).on('value', (snapshot) => {
        var user = snapshot.val();

        stripe.customers.update(user, srcId,
            function(err, response) {
                if(err != null) {console.log("Error: " + JSON.stringify(err))}
                if(response != null) {

                    console.log("Source save " + JSON.stringify(response));
                }
              }
            );
      }, function (errorObject) {
        console.log("The read failed: " + errorObject.code);
      });

    */
    /*

    console.log("change default source")
    stripe.customers.update("cus_AFGbOSiITuJVDs", {
        default_source: "src_18eYalAHEMiOZZp1l9ZTjSU0"
      });
      */


      



