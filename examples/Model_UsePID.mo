model Model_UsePID
  annotation(__MWORKS(version="26.1.3"),Diagram(coordinateSystem(extent={{-100,-100},{100,100}},
grid={2,2})));
  Model_SyncPIDController model_SyncPIDController 
    annotation (Placement(transformation(origin={-8,14},
extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Sources.Constant const 
    annotation (Placement(transformation(origin={-60,17.978},
extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Sources.Constant const1 
    annotation (Placement(transformation(origin={-60,-12},
extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Sources.Constant const2 
    annotation (Placement(transformation(origin={-60,-41.97798},
extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Sources.BooleanConstant booleanConstant 
    annotation (Placement(transformation(origin={-60,47.956},
extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Interfaces.RealOutput y 
    annotation (Placement(transformation(origin={50,13.9909},
extent={{-10,-10},{10,10}})));
equation
  connect(const.y, model_SyncPIDController.manualOpening) 
  annotation(Line(origin={-34,18},
  points={{-15,-0.02202},{15.0602,-0.02202}},
  color={0,0,127}));
  connect(const1.y, model_SyncPIDController.setPoint) 
  annotation(Line(origin={-34,2},
points={{-15,-14},{-2,-14},{-2,11.9999},{15.07,11.9999}},
color={0,0,127}));
  connect(const2.y, model_SyncPIDController.measure) 
  annotation(Line(origin={-28,-20},
  points={{-21,-21.978},{20.0089,-21.978},{20.0089,22.9318}},
  color={0,0,127}));
  connect(booleanConstant.y, model_SyncPIDController.isPIDcontrol) 
  annotation(Line(origin={-34,34},
points={{-15,13.956},{-6,13.956},{-6,-14.0048},{15.0844,-14.0048}},
color={255,0,255}));
  connect(model_SyncPIDController.controlSignal, y) 
  annotation(Line(origin={26,14},
  points={{-23.0033,-0.00914117},{24,-0.00914117}},
  color={0,0,127}));
  end Model_UsePID;