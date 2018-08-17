const functions = require('firebase-functions');
var stripe = require("stripe")("sk_test_9YgUPJIi44UxQ9Rr3JqQ7I20");


const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

exports.sendMessageToUser = functions.https.onRequest((req, res) => {
    const customerId = req.query.customerId;
    console.log("Customer Id is: " + customerId);
    const title = req.query.title;
    console.log("Title is " + title);
    const body = req.query.body;
    console.log("Body is " + body);

    sendMessage(customerId, title, body);

    res.send("sendMessage Requested");
    return
});

function sendMessage(customerId, title, body) {
    // Get the Messaging service for the default app
    var defaultMessaging = admin.messaging();

    var db = admin.database();
    var ref = db.ref('user/' + customerId);
    ref.once("value", function (snapshot) {
        console.log("Send Message to: " + snapshot.val());
        var loggedIn = snapshot.child('loggedIn').val();
        var registrationToken = snapshot.child('firebaseToken').val();

        if(!loggedIn) {
            createErrorTicket("Message Send Fail", "User " + customerId + " is not logged in");
            return
        } else {
    // See documentation on defining a message payload.
        var message = {
            notification: {
                title: title,
                body: body
              },
            token: registrationToken
        };

        // Send a message to the device corresponding to the provided
        // registration token.
        admin.messaging().send(message)
            .then((response) => {
                // Response is a message ID string.
                console.log('Successfully sent message:', response);
            })
            .catch((error) => {
                console.log('Error sending message:', error);
            });
        }
    });
    
}

exports.printSomething = functions.database
    .ref('user')
    .onWrite((event) => {
        console.log("Something Changed")
    });


exports.createCard = functions.database.ref('user/{userID}/cards/{cardID}').onCreate((snap, context) => {
    console.log("Create Card");
    console.log("Create Value: " + snap.val());
    const card = snap.val()
    if (card.valid === 100) {

    }

});


exports.getStripeCustomerId = functions.database.ref('user/{userID}').onCreate((snap, context) => {
    console.log("Create StripeId" + snap.val().emailAddress);

    stripe.customers.create(
        { email: snap.val().emailAddress },
        function (err, customer) {
            err; // null if no error occurred
            customer; // the created customer object
            if (err != null) { console.log("Error: " + JSON.stringify(err)) }
            if (customer != null) {
                const customerId = customer.id
                console.log("Customer: " + JSON.stringify(customer.id));
                snap.ref.child('stripeId').set(customerId);
                console.log("StripeId set " + customerId);
            }
        }
    );
});

exports.updateDefaultSource = functions.database.ref('user/{userID}/srcId').onWrite((snap, context) => {

    console.log("updateDefaultSource " + JSON.stringify(snap));

    const srcId = snap.after.val();



    var db = admin.database();
    var ref = db.ref(snap.after.ref.parent.child('stripeId'));

    // Attach an asynchronous callback to read the data at our posts reference
    ref.once("value", function (snapshot) {
        console.log(snapshot.val());
        var user = snapshot.val();

        stripe.customers.createSource(user, {
            source: srcId
        }, function (err, source) {
            if (err != null) { console.log("Error: " + JSON.stringify(err)) }
            if (source != null) {

                console.log("Source save " + JSON.stringify(source));

                stripe.customers.update(user, {
                    default_source: srcId,
                }, function (err, customer) {
                    if (err != null) { console.log("Error: " + JSON.stringify(err)) }
                    if (customer != null) {

                        console.log("Source save " + JSON.stringify(customer));
                    }
                });
            }
        });


    });
});

exports.createOrderInstances = functions.https.onRequest((req, res) => {

    console.log("createOrderInstances");

    var db = admin.database();
    var ref = db.ref("user");

    res.send("Creating order instances");


    ref.once("value", function (snapshot) {

        snapshot.forEach(function (child) {
            if (child.hasChild("order")) {

                const newRef = db.ref("order_instances").push();
                const id = newRef.key;
                const order = child.val().order;
                const date = Date(); //CHECK
                const customerName = child.val().name;
                const customerPhone = child.val().phone;
                var orderInstance = {
                    id: id,
                    order: order,
                    date: date,
                    customerName: customerName,
                    customerPhone: customerPhone,
                    providerId: "",
                    customerId: child.key,
                    status: 0,
                    bags: []
                };

                newRef.set(orderInstance);

                ref.child(child.key + "/customer_instance_index/" + id).set(1);
            }
        });

    });
});

exports.watchStatus = functions.database.ref('order_instances/{instanceID}/status').onWrite((snap, context) => {

    console.log("watchStatus " + JSON.stringify(snap));

    var db = admin.database();
    var parentRef = db.ref(snap.after.ref.parent);
    const status = snap.after.val();
    const instanceId = snap.after.ref.parent.key;
    db.ref('order_instances/' + instanceId + '/status_history').push().set(status); //Track all status changes

    var providerStatus = 1;
    if (status > 29) {
        providerStatus = 0;
    }
    console.log("will updateProviderStatus");
    updateProviderStatus(providerStatus, instanceId);

    switch (status) {
        case 0: //New Instance, needs authorization
            console.log("Status 0");
            assignToProvider(instanceId);
            break;
        case 10: //Order is assigned and awaiting pickup
            //Do nothing
            break;
        case 19: //Customer is no show, charge no show fee and finalize
            parentRef.once("value", function (snapshot) {
                console.log(snapshot.val());
                if (snapshot.val() != null && snapshot.val() != "") { }
                var instanceId = snapshot.child('id').val();
                var customerId = snapshot.child('customerId').val();
                console.log("Charge card from no show status watcher");
                chargeCard(19, customerId, instanceId);
                updateProviderStatus(1, instanceId);
            });

            break;
        case 20: //Order is picked up, awaiting return, charge customer




            parentRef.once("value", function (snapshot) {
                console.log(snapshot.val());
                if (snapshot.val() != null && snapshot.val() != "") { }
                var instanceId = snapshot.child('id').val();
                var customerId = snapshot.child('customerId').val();
                console.log("Charge card from pickup status watcher");
                chargeCard(20, customerId, instanceId);
            });
            break;
        case 21: //Successful charge, do nothing
            break;
        case 30: //Bags are returned, Finalize order, add payout to provider account

            if (snap.before.val() == 22 || snap.before.val() == 20) {
                db.ref('order_instances/' + instanceId + '/status').set(32);
            } else {
                db.ref('order_instances/' + instanceId + '/status').set(41);
            }

            break;
        case 41:
            //Do nothing, use end of period review to finalize orders
            break;
        case (50 < status < 60):
            //This is a finalized order. Do nothing. Maybe archive someday in the future to optimize database.
            break;
        default: //Any other status at any point will need to be handled by customer service until automated
            createErrorTicket("Status: " + status, "Instance: " + instanceId);
            break;
    }

});

/*
Status codes ranges:
0 = Unauthorized
10 = Authorized and assigned awaiting pickup
20 = Picked up awaiting return
30 = Returned
40 = Returned and payment received
50 = Finalized and payout authorized
100 = Invalid (Test data)

Single digits:
1 = payment successful
2 = payment failed
5 = provider problem
6 = delay
7 = system problem
8 = customer service problem
_________________________
New:
00 = new instance * (Start here for flow)
01 = authorized *
02 = unauthorized 
05 = authorized and unable to assign to provider

Assigned:
10 = awaiting pickup *
15 = provider failure **
16 = running late for pickup 
17 = system error
18 = customer problem such as no door code on pickup
19 = no show **

Picked up:
20 = picked up, no charge yet *
21 = picked up and payment processed successfully **
22 = picked up and payment failed
25 = provider problem to return laundry
26 = provider running late 
27 = system error
28 = customer problem such as no door code on return

Returned:
30 = Returned *
32 = Payment incomplete
35 = Payment incomplete and provider problem

Returned and payment complete (What to do with payout):
41 = Returned and payment successful - Best case *
42 = Returned and payment problem 
45 = Returned and provider problem 
48 = Returned and customer service problem

Finalized (all customer service and payment issues resolved or written off):
51 = Everything settled, payout added to provider roll
52 = Customer did not pay, written off, payout added to provider roll
55 = Unresolved provider issue, no payout
58 = Customer service problem, payout to provider

*/

function chargeCard(status, customerId, instanceId) {

    console.log("chargeCard 1");
    var db = admin.database();
    var userRef = db.ref("/user/" + customerId);

    // 1. Get StripeId
    userRef.once("value", function (snapshot) {
        console.log("chargeCard 2");
        console.log(snapshot.val());
        if (snapshot.val() != null && snapshot.val() != "") {
            var stripeId = snapshot.child("stripeId").val();
            // 2. Get price from zip code
            var priceRef = db.ref("/zip/" + snapshot.child("order").child("zip").val());
            priceRef.once("value", function (snapshot) {
                console.log("chargeCard 3");
                var taxPercent = snapshot.child("taxPercentage").val();
                var basePrice = snapshot.child("standard_price").val();
                var noShowFee = snapshot.child("no_show_fee").val();
                // 3. Get number of bags from order instance
                var bagRef = db.ref("order_instances/{instanceID}/bags");
                bagRef.once("value", function (bagSnap) {
                    console.log("chargeCard 4");
                    var noShowCharge = 0;
                    var bagCount = 0;
                    if (status == 19) {
                        console.log("No bags, no show");
                        noShowCharge = noShowFee;
                    } else {

                        bagSnap.forEach(function (child) {
                            bagCount = bagCount + 1;
                        })
                    }
                    // 4. Calculate final price
                    var subTotal = noShowCharge + (basePrice * bagCount);
                    var taxes = subTotal * taxPercent;
                    var finalPrice = subTotal + taxes;
                    const map = {
                        subTotal: subTotal,
                        taxes: taxes,
                        finalPrice: finalPrice,
                    }
                    db.ref("order_instances/" + instanceId + "/charge").set(map);
                    // 5. Charge the card
                    stripe.charges.create({
                        amount: finalPrice,
                        currency: 'usd',
                        customer: stripeId

                    }, function (err, charge) {
                        console.log("chargeCard 5");
                        if (err != null) {
                            console.log("Error: " + JSON.stringify(err));
                            db.ref('order_instances/' + instanceId + '/status').set(22);
                            // To do: Save new status and save the final price as a breakdown for receipt
                        }

                        if (charge != null) {
                            console.log("Charge: " + JSON.stringify(charge));
                            //Save new status if charge was successful to 21
                            if (charge.status == "succeeded") {
                                db.ref('order_instances/' + instanceId + '/status').set(21);
                            } else {
                                db.ref('order_instances/' + instanceId + '/status').set(22);
                            }
                        }

                    });
                });
            });

        }
    })
};

function updateProviderStatus(providerStatus, instanceId) { //ProviderStatus 1 = open, 0 = closed
    console.log("updateProviderStatus: " + providerStatus + " " + instanceId);
    var db = admin.database();
    var instanceRef = db.ref("order_instances/" + instanceId);
    instanceRef.once("value", function (snap) {
        console.log("updateProviderStatus 2");
        const orderInstance = snap.val();
        if (orderInstance.providerId != null && orderInstance.providerId != "") {
            var providerRef = db.ref("user/" + orderInstance.providerId + "/orderInstanceIndex/" + instanceId);
            providerRef.set(providerStatus)
        }
    });
}

function assignToProvider(instanceId) {
    var db = admin.database();
    var instanceRef = db.ref("order_instances/" + instanceId);
    instanceRef.once("value", function (snap) {
        const orderInstance = snap.val();
        if (orderInstance.providerId != null && orderInstance.providerId != "") {
            unassignFromProvider(orderInstance.providerId);
        }

        const order = snap.child("order").val();
        providerId = "aYDXz0mBaDf9t0R0Zg4V4e5lYHR2"; //Later add alorithm to find best
        const providerIdRef = db.ref("order_instances/" + instanceId + "/providerId");
        providerIdRef.set(providerId);
        console.log("AssignedProviderRef 0");
        const assignedProviderRef = db.ref("user/" + providerId + "/orderInstanceIndex/" + instanceId);
        console.log("AssignedProviderRef 0.5");
        assignedProviderRef.set(1);
        console.log("AssignedProviderRef 1");

        const checkProviderRef = db.ref("user/" + providerId + "/orderInstanceIndex/");

        checkProviderRef.once("value", function (snap1) {
            console.log("AssignedProviderRef 2");
            if (snap1.hasChild(instanceId)) {
                console.log("AssignedProviderRef 3");
                db.ref('order_instances/' + instanceId + '/status').set(10);
                return
            } else {
                console.log("AssignedProviderRef 4");
                db.ref('order_instances/' + instanceId + '/status').set(05);
                return
            }
        });
    });
}

function unassignFromProvider(providerId, instanceId) {
    var db = admin.database();
    var providerIndexRef = db.ref('user/' + providerId + '/orderInstanceIndex/')
    providerIndexRef.child(instanceId).remove();

    providerIndexRef.once("value", function (snap) {
        const indexList = snap.val();
        if (indexList.hasChild(instanceId)) {
            createErrorTicket("System", "Order instance " + instanceId +
                " was not successfully unassigned from " + providerId);
        }
    });
}

function createErrorTicket(type, message) {
    console.log("Error Ticket: \nType: " + type + "\nMessage: " + message);
}

exports.finalizeSuccessfulOrderInstances = functions.https.onRequest((req, res) => {

    console.log("finalize");

    var db = admin.database();
    var ref = db.ref("order_instances");

    res.send("Finalizing");

    ref.once("value", function (snap) {
        snap.forEach(function (child) {
            var instanceId = child.key
            var status = child.child("status").val()
            if (status == 41) {
                ref('order_instances/' + instanceId + '/status').set(51);
            } else if (40 < status < 50) {
                createErrorTicket("Finalization Error", "Instance " + instanceId + " cannot be finalized. Status is: " + status);
            }

        });

    });



});