const k8s = require('@kubernetes/client-node');

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sCore = kc.makeApiClient(k8s.CoreV1Api);
const k8sApp = kc.makeApiClient(k8s.AppsV1Api);
const k8sCustom = kc.makeApiClient(k8s.CustomObjectsAp);

k8sCustom.listNamespacedCustomObject('networking.istio.io', 'v1beta1', 'agys-stay', 'virtualservices', '', '', 'metadata.name==agys-stay-services-prod').then((res) => {
    console.log(res.body);
}).catch(console.log);

k8sCustom.listClusterCustomObject('networking.istio.io', 'v1beta1', 'virtualservices').then((res) => {
    console.log(res.body);
})

k8sApp.listNamespacedDeployment('agys-stay').then((res) => {
    console.log(res.body);
})

k8sCore.listNamespacedPod('agys-stay').then((res) => {
    console.log(res.body);
});