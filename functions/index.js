const {initializeApp}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {getMessaging}=require("firebase-admin/messaging");
const {onDocumentCreated,onDocumentUpdated}=require("firebase-functions/v2/firestore");
const {logger}=require("firebase-functions");

initializeApp();
const db=getFirestore();
const REGION="asia-northeast1";

async function recipientTokens(excludedUid){
  const users=await db.collection("allowedUsers").where("active","==",true).get();
  const records=[];
  for(const user of users.docs){
    if(user.id===excludedUid)continue;
    const tokens=await db.collection("notificationTokens").doc(user.id).collection("tokens").where("active","==",true).get();
    tokens.docs.forEach(tokenDoc=>{
      const token=tokenDoc.data().token;
      if(token)records.push({token,ref:tokenDoc.ref});
    });
  }
  return records;
}

async function sendShoppingNotification({actorUid,title,body,eventId}){
  const records=await recipientTokens(actorUid);
  if(!records.length){logger.info("No notification recipients",{eventId});return}
  const response=await getMessaging().sendEachForMulticast({
    tokens:records.map(record=>record.token),
    data:{title,body,eventId,url:"./index.html"}
  });
  const invalidCodes=new Set(["messaging/invalid-registration-token","messaging/registration-token-not-registered"]);
  await Promise.all(response.responses.map((result,index)=>{
    if(!result.success&&invalidCodes.has(result.error?.code))return records[index].ref.delete();
    return null;
  }));
  logger.info("Shopping notification sent",{eventId,success:response.successCount,failure:response.failureCount});
}

exports.notifyShoppingAdded=onDocumentCreated({document:"events/{eventId}",region:REGION},async event=>{
  const data=event.data?.data();
  if(!data||data.category!=="shopping"||data.action!=="wanted")return;
  const actor=data.createdByName||"家族";
  await sendShoppingNotification({
    actorUid:data.createdBy,
    title:"買い物リストに追加",
    body:`${actor}さんが「${data.item||"商品"}」を追加しました`,
    eventId:event.params.eventId
  });
});

exports.notifyShoppingBought=onDocumentUpdated({document:"events/{eventId}",region:REGION},async event=>{
  const before=event.data?.before.data();
  const after=event.data?.after.data();
  if(!before||!after||after.category!=="shopping"||before.action==="bought"||after.action!=="bought")return;
  const actor=after.updatedByName||after.createdByName||"家族";
  await sendShoppingNotification({
    actorUid:after.updatedBy||after.createdBy,
    title:"買い物完了",
    body:`${actor}さんが「${after.item||"商品"}」を買いました`,
    eventId:event.params.eventId
  });
});
