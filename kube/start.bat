kubectl delete secret -n aaas gaconfig
kubectl create secret -n aaas generic gaconfig --from-file=gaconf=secrets/config.json

kubectl delete -f frontend.yaml
kubectl create -f frontend.yaml