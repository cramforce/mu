if(typeof dw != "undefined" && dw.net && dw.net.HTTPClient ) {
  importScript("ext/json2.ds");
  window = {
    isDemandWare: true,
    location: {
      toString: function () { return "server side" },
      protocol: "http:"
    }
  };
  
  document = {
    cookie: ""
  };
}